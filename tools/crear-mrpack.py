"""Empaqueta un perfil de Minecraft en un .mrpack con TODO dentro de overrides/.

No usa referencias de Modrinth: cada jar va tal cual está en tu carpeta, así que
los mods modificados a mano se conservan byte a byte.

Uso:
    python crear-mrpack.py "E:/MainGames/profiles/PeruLand 1.0.0 (1)" --name PeruLand --version 1.0.0
"""
import argparse
import json
import os
import zipfile

# Lo que va dentro del pack (carpetas y archivos sueltos del perfil).
INCLUDE_DIRS = ["mods", "config", "resourcepacks", "shaderpacks", "datapacks"]
INCLUDE_FILES = ["options.txt", "servers.dat"]
# Extensiones que se cargan / tienen sentido dentro de mods/.
MOD_EXTS = (".jar", ".jar.disabled")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("profile")
    ap.add_argument("--name", required=True)
    ap.add_argument("--version", required=True)
    ap.add_argument("--mc", default="1.21.1")
    ap.add_argument("--fabric", default="0.19.3")
    ap.add_argument("--out", help="ruta del .mrpack (por defecto junto al perfil)")
    args = ap.parse_args()

    out = args.out or os.path.join(os.path.dirname(os.path.abspath(args.profile)),
                                   f"{args.name}-{args.version}.mrpack")
    index = {
        "formatVersion": 1,
        "game": "minecraft",
        "versionId": args.version,
        "name": args.name,
        "files": [],  # vacío a propósito: nada se descarga de Modrinth
        "dependencies": {"minecraft": args.mc, "fabric-loader": args.fabric},
    }

    count = 0
    skipped = []
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("modrinth.index.json", json.dumps(index, indent=2))
        for d in INCLUDE_DIRS:
            base = os.path.join(args.profile, d)
            for root, _, files in os.walk(base):
                for f in files:
                    full = os.path.join(root, f)
                    rel = os.path.relpath(full, args.profile).replace(os.sep, "/")
                    if d == "mods" and not f.endswith(MOD_EXTS):
                        skipped.append(rel)
                        continue
                    z.write(full, "overrides/" + rel)
                    count += 1
        for f in INCLUDE_FILES:
            full = os.path.join(args.profile, f)
            if os.path.isfile(full):
                z.write(full, "overrides/" + f)
                count += 1

    print(f"{out}\n{count} archivos empaquetados, {os.path.getsize(out) / 1e6:.1f} MB")
    for s in skipped:
        print("omitido (no es .jar):", s)


if __name__ == "__main__":
    main()
