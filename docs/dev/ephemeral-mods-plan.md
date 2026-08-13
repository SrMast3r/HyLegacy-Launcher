# Ephemeral (In-Memory) Mod Loading — Implementation Plan

Status: draft / not implemented
Owner: HyLegacy Launcher team
Related: [home.js](../../src/assets/js/panels/home.js) (launch flow, `JVM_ARGS`), `minecraft-java-core` (JVM spawn), packwiz integration (public mod install)

## 1. Goal

Deliver a subset of "premium"/exclusive mods to players **without ever writing the finished `.jar` to the instance's `mods/` folder**, so the file can't just be copied out of `%appdata%/.../instances/<name>/mods/` and redistributed. The class bytes should exist only inside the running Minecraft JVM's memory, fetched fresh (and decrypted) on every launch.

This is the same technique used by the third-party `neoephimeraltool` Fabric mod we reverse-engineered (see prior analysis in this conversation): a `Premain-Class` Java agent + a custom in-memory `ClassLoader` + early injection into the mod loader's discovery phase. This plan adapts that technique to run from **our own launcher** instead of as a foreign Fabric mod, for the reasons discussed (full control over the JVM command line, no dependency on Fabric internals for identity/session handling, works the same across loaders).

## 2. Threat model — be honest about what this buys us

**Stops:**
- Casual copying: a user browsing `mods/` and grabbing the `.jar` to share on Discord/a modpack site.
- Automated modpack scrapers that just zip up the `mods/` folder.
- Reuse of the mod outside our launcher (it won't run without our decrypt key + a live session).

**Does NOT stop:**
- A determined user attaching a Java agent/debugger to the running JVM and dumping loaded classes from memory (e.g. via `Instrumentation.retransformClasses` snooping, JVM heap dump, or a `-javaagent` of their own). Once bytecode is loaded into the JVM, it is decrypted and inspectable *in principle* — this design raises the bar, it does not make extraction impossible.
- Network interception if TLS is somehow defeated on the user's own machine (they control the box, so a sufficiently motivated user can MITM their own loopback traffic).
- Someone with legitimate access decompiling the mod's *behavior* by observing it at runtime (screen recording, in-game inspection tools like WorldEditCUI-style debug overlays, etc.).

Treat this as **raising the cost of casual mod theft**, not as unbreakable DRM. Document this internally so support/marketing don't oversell it.

## 3. High-level architecture

```
┌─────────────────────────┐        1. login, request pack manifest
│  Electron Launcher (Node)│ ───────────────────────────────────┐
│  - owns user session      │                                    │
│  - owns decrypt keys       │                                    ▼
│  - builds JVM_ARGS          │                      ┌─────────────────────┐
│  - writes bridge.json         │                      │  Content API (backend) │
└─────────────┬───────────────┘                      │  neobeta-style server  │
              │ 2. spawn JVM with -javaagent=stub.jar │  - issues per-session   │
              │    + bridge.json (nonce, port, key-id)│    encrypted payload    │
              ▼                                       └───────────┬─────────────┘
┌───────────────────────────────────────┐                          │
│  Minecraft JVM                          │  3. agent reads bridge.json,        │
│  ┌─────────────────────────────────┐  │     calls back to API/launcher for   │
│  │ Bootstrap Java Agent (premain)    │◄─┴── the encrypted jar bytes          │
│  │  - Instrumentation hook            │
│  │  - decrypts payload in RAM         │
│  │  - InMemoryClassLoader.defineClass │
│  │  - registers with Fabric Loader's  │
│  │    mod candidate list (reflection) │
│  └─────────────────────────────────┘  │
│  Fabric Loader → mods run as normal,   │
│  but their .class bytes never touched   │
│  disk as a .jar                          │
└───────────────────────────────────────┘
```

Nothing related to the protected mod ever gets written under `instances/<name>/mods/`. Public/free mods keep going through the existing packwiz flow unchanged.

## 4. Components

### 4.1 Content API (backend, new)

- `POST /api/ephemeral/session` — launcher exchanges the player's auth (already verified server-side by us, not just trusted from the client) for a short-lived **session token** scoped to one instance + one launch.
- `GET /api/ephemeral/payload?session=...` — returns the encrypted jar bundle (AES-GCM, per-session key derived from the session token) for the JVM-side agent to fetch directly. Bind the payload to:
  - `instanceId`
  - `sessionId` / `nonce` (single use, short TTL — e.g. 60s)
  - the machine/account that requested it (so a leaked payload can't be replayed on someone else's machine after expiry)
- Rate-limit and log requests; a spike in payload requests from one account is a signal of abuse.

### 4.2 Launcher (Electron/Node) changes

Today [home.js:477](../../src/assets/js/panels/home.js:477) already threads `JVM_ARGS: options.jvm_args || []` into `minecraft-java-core`'s `Launch()`. We extend this launch path:

1. Before calling `launch.Launch(opt)`, if the selected instance has protected content (`options.ephemeral_pack_id` or similar), the launcher:
   - Calls the Content API with the already-authenticated session (reuse the `authenticator` object already read at [home.js:452](../../src/assets/js/panels/home.js:452)) to obtain a **session token + nonce**.
   - Picks a free local TCP port (or uses a Unix domain socket / named pipe on Windows) for local IPC.
   - Writes a `bridge.json` into the instance's private data dir (NOT `mods/`) containing `{ instanceId, nonce, port, expiresAt }`. No decryption key goes in this file — the agent must present the nonce back to the API to get the key.
   - Starts a short-lived local IPC listener (the "bridge") that will only answer one request, only from `localhost`, only while the nonce is valid, then closes.
2. Adds `-javaagent:<pathToBootstrapAgentJar>=<pathToBridgeJson>` to `opt.JVM_ARGS`.
3. The bootstrap agent jar itself ships inside the launcher's install directory (e.g. `app/resources/ephemeral-agent.jar`), never inside the instance's `mods/` folder — it's launcher infrastructure, not "a mod".

```js
// pseudocode addition near home.js:476-478
if (options.ephemeral_pack_id) {
    const bridge = await ephemeral.prepareSession(options, authenticator);
    opt.JVM_ARGS = [
        ...(options.jvm_args || []),
        `-javaagent:${ephemeral.agentJarPath()}=${bridge.bridgeFilePath}`
    ];
}
```

### 4.3 Bootstrap Java Agent (new small Java project, built by us)

- Entry point: `premain(String agentArgs, Instrumentation inst)`.
- Reads `bridge.json` (path passed as `agentArgs`).
- Opens a connection to `127.0.0.1:<port>` from `bridge.json`, sends the `nonce` once.
- Launcher's bridge listener validates nonce + expiry, replies with a **one-time decrypt key** (or directly proxies the encrypted payload — see 4.6), then closes the socket and deletes `bridge.json`.
- Fetches the encrypted jar bytes (either from the launcher bridge or directly from the Content API using a short-lived token also delivered over the bridge).
- Decrypts in memory, hands the byte map to the `InMemoryClassLoader`.

### 4.4 In-Memory ClassLoader

```java
final class InMemoryClassLoader extends ClassLoader {
    private final Map<String, byte[]> classBytes;   // "com/foo/Bar" -> bytecode
    private final Map<String, byte[]> resourceBytes; // e.g. fabric.mod.json, assets

    InMemoryClassLoader(ClassLoader parent, Map<String, byte[]> classBytes, Map<String, byte[]> resourceBytes) {
        super(parent);
        this.classBytes = classBytes;
        this.resourceBytes = resourceBytes;
    }

    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        byte[] bytes = classBytes.get(name.replace('.', '/') + ".class");
        if (bytes == null) throw new ClassNotFoundException(name);
        return defineClass(name, bytes, 0, bytes.length);
    }

    @Override
    protected URL findResource(String name) {
        // wrap resourceBytes in a custom URLStreamHandler / in-memory URL
        // so fabric.mod.json inside the payload can be read without disk I/O
    }
}
```

Key point: `classBytes`/`resourceBytes` come straight from the decrypted network payload — **at no point is a `.jar` file constructed on disk**. Zero out the plaintext byte arrays after `defineClass` where practical to shrink the window they're sitting decrypted in the heap.

### 4.5 Fabric Loader mod-candidate injection

Fabric Loader (Knot) discovers mods by scanning the classpath and `mods/` during its own bootstrap, before most agent/mixin code normally runs. To make Loader treat our in-memory jar as a real mod (so its `fabric.mod.json` entrypoints, mixins, etc. get processed), the agent needs to inject a synthetic mod candidate **before Loader finishes discovery** — this only works because `premain` runs before the game's `main()`.

This part is inherently version-fragile (touches Fabric Loader internals via reflection, similar to what `neoephimeraltool`'s `EphemeralJarLoader` does with `"Registered ephemeral mod candidate early"`). Concretely:

- Reflectively reach `net.fabricmc.loader.impl.discovery.ModDiscoverer` (or the current version's equivalent) before it locks in its candidate list.
- Construct a `ModCandidate` backed by our `InMemoryClassLoader` instead of a `Path` to a jar.
- Register it the same way Loader would register a path-based candidate.

**Action item:** pin this against the exact Fabric Loader version we ship and add a CI check that fails loudly if Loader's internal class/method names change on update (this is the single biggest maintenance risk in the whole plan).

### 4.6 Local bridge (launcher ↔ JVM IPC)

Two viable designs — pick one:

- **A. Key-only bridge (recommended):** the agent still calls the Content API over HTTPS itself to fetch the encrypted payload (using a short-lived token handed over via the local bridge). Keeps the launcher out of the data path for large payloads; the local socket only ever carries a small token, never the mod bytes.
- **B. Full-proxy bridge:** the launcher fetches the payload itself (it already has network + auth code) and streams it to the agent over the local socket. Simpler agent code, but the launcher process now handles the sensitive bytes too — fine, since the launcher is equally trusted, but means the local socket carries the entire payload, so it must be strictly localhost-only and closed immediately after use.

Either way: **bind the bridge listener to `127.0.0.1` only**, single connection, single use, hard timeout (a few seconds), delete `bridge.json` after the handshake completes or times out.

## 5. End-to-end flow

1. User clicks Play on an instance with protected content.
2. Launcher authenticates the request against the Content API using the already-signed-in account (reuse existing session, don't re-derive from CLI args like the third-party mod does).
3. Launcher generates a nonce, opens a one-shot local listener, writes `bridge.json`.
4. Launcher appends `-javaagent:...` to `JVM_ARGS` and calls `launch.Launch(opt)` as today.
5. JVM starts → agent `premain` runs → reads `bridge.json` → talks to the local bridge → gets a short-lived key/token.
6. Agent fetches the encrypted payload from the Content API, decrypts in memory.
7. Agent builds `InMemoryClassLoader`, injects a synthetic mod candidate into Fabric Loader's discovery.
8. Fabric Loader continues bootstrapping as usual; the protected mod's entrypoints/mixins run exactly like a normal mod, but its `.class`/`.jar` bytes were never written to `instances/<name>/mods/`.
9. On JVM exit, everything is garbage — nothing persists.

## 6. Security design notes

- **Encrypt payloads with AES-GCM**, one-time symmetric key per session, key delivered only over the local bridge or a short-lived signed token — never embed a static key in the launcher binary.
- **Scope the session token** to `instanceId + accountId + short TTL` server-side, so a captured token is useless a minute later or on another machine.
- **Don't reimplement the fragile `sun.java.command` regex parsing** the third-party mod uses to steal the Minecraft access token. Our launcher already owns the authenticated session object at [home.js:452](../../src/assets/js/panels/home.js:452) — pass what the agent needs explicitly and only for the duration of the handshake, not the full Microsoft/Mojang access token.
- **Log server-side** every payload issuance (account, instance, IP, timestamp) so abuse (token sharing, scripted mass-download) is detectable without needing client-side telemetry that itself becomes a privacy liability.
- **Do not phone home with more than necessary.** The original mod sends heartbeats/reports on a schedule; if we need usage metrics, batch and anonymize, and disclose it in our own terms of service — unlike the analyzed mod, which had blank author/license metadata and no disclosure.

## 7. Implementation checklist

- [ ] Backend: `POST /api/ephemeral/session` + `GET /api/ephemeral/payload` endpoints, session/nonce storage (Redis or similar, TTL-based).
- [ ] Backend: payload encryption pipeline (build step that packages the protected mod, encrypts it, stores ciphertext + metadata).
- [ ] New Java project: bootstrap agent (`premain`, bridge client, `InMemoryClassLoader`, Fabric candidate injection). Target the same Fabric Loader / Minecraft version matrix we currently support.
- [ ] Launcher: `ephemeral.js` module — session negotiation, nonce generation, local bridge server, `bridge.json` lifecycle, JVM_ARGS wiring (extends the block around [home.js:462-484](../../src/assets/js/panels/home.js:462)).
- [ ] Launcher: instance config schema gains `ephemeral_pack_id` (or similar) so only instances that actually have protected content trigger this path; everything else keeps using the existing packwiz flow untouched.
- [ ] CI: pin Fabric Loader version used for reflection targets; add a smoke test that fails the build if Loader's internal discovery API shape changes.
- [ ] Telemetry/logging: server-side issuance log, no extra client-side tracking beyond what's already disclosed.
- [ ] Docs: internal runbook for rotating the encryption key and revoking a compromised session.

## 8. Testing plan

- Unit test the `InMemoryClassLoader` in isolation (load a trivial test jar's bytes, confirm `Class.forName` works, confirm no file appears under the test temp dir).
- Integration test: full launch of a throwaway instance with a dummy protected "hello world" mod, assert `instances/<name>/mods/` is unchanged after launch and the dummy mod's log line appears in game output.
- Failure-mode tests: bridge timeout, expired nonce, network failure fetching payload, corrupted/tampered ciphertext (must fail closed — game either falls back to running without the protected content or shows a clear error, never silently loads garbage).
- Version-bump test: run the same integration test against a newer Fabric Loader release before shipping an update, to catch the reflection-breakage risk called out in 4.5.

## 9. Known limitations / non-goals

- Not resistant to a user with a debugger/agent of their own attached to the same JVM — see §2.
- Adds a hard network dependency to launch: protected content can't be played offline. Decide product-side whether that's acceptable, or whether to add a short-lived offline grace period (would require caching an encrypted blob locally with its own expiry — a deliberate, scoped exception to "never touches disk", not an accidental one).
- Every Fabric Loader/Minecraft version bump is a maintenance event for the reflection-based mod-candidate injection (§4.5). Budget time for it in the update process, don't treat it as fire-and-forget.
- This protects mod **files**, not mod **behavior** — anyone can still observe what the mod does at runtime by playing the game. It stops redistribution of the artifact, not reverse engineering of its effects.

## 10. Rollout

1. Ship the backend + agent + launcher wiring behind a feature flag, tested only on an internal/staging instance.
2. Dogfood with one real protected mod on the team's own test pack.
3. Roll out to a single opt-in public instance, monitor error rates (bridge timeouts, payload fetch failures) before enabling broadly.
4. Keep the packwiz path as the default for all non-protected content — this system is additive, not a replacement.
