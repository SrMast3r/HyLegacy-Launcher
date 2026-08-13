# Cómo crear una nueva instancia (con packwiz)

Guía rápida para agregar una instancia nueva al launcher — desde crear el pack hasta que aparezca jugable en el cliente.

---

## 1. Crear la carpeta de la instancia

Dentro de `files/instances/`, crea una carpeta con el **nombre exacto** que quieras que tenga la instancia (así aparece en el launcher):

```bash
cd files/instances
mkdir MiInstanciaNueva
cd MiInstanciaNueva
```

## 2. Inicializar el pack con packwiz

```bash
packwiz init --name "MiInstanciaNueva" --author "HyLegacy" --version "1.0.0" \
  --mc-version "1.20.1" --modloader "fabric" --fabric-latest -y
```

Ajusta según tu instancia:
- `--mc-version` → la versión de Minecraft.
- `--modloader` → `forge`, `fabric`, `quilt` o `neoforge`.
- En vez de `--fabric-latest`, puedes usar `--forge-version "XX.X.X"` / `--fabric-version "X.X.X"` si necesitas una versión específica del loader.

Esto crea `pack.toml` e `index.toml` en la carpeta.

## 3. Agregar mods

```bash
packwiz modrinth install sodium
packwiz modrinth install lithium
packwiz curseforge install jei      # si el mod está en CurseForge en vez de Modrinth
```

Cada mod agregado crea un archivo `mods/<mod>.pw.toml` — no se copia el `.jar`, solo la referencia (hash + URL al CDN de Modrinth/CurseForge). Así el jugador lo descarga directo de ahí, no de nuestro servidor.

### Mods personalizados (no están en Modrinth/CurseForge)

Copia el `.jar` directo dentro de `mods/` y corre:

```bash
packwiz refresh
```

Ese mod sí lo va a servir nuestro propio servidor (no hay otro CDN al que apuntar), pero se sigue verificando por hash igual que todo lo demás.

## 4. Registrar la instancia en `instances.php`

Abre `files/php/instances.php` y agrega un bloque nuevo (copia el patrón de `PokeMoonX`):

```php
$instance['MiInstanciaNueva'] = array_merge($instance['MiInstanciaNueva'], array(
    "loadder" => array(
        "minecraft_version" => "1.20.1",
        "loadder_type" => "fabric",
        "loadder_version" => "0.15.11"   // la versión exacta del loader que packwiz usó
    ),
    "image" => "https://tu-imagen-de-portada.png",
    "verify" => false,                    // IMPORTANTE: false en instancias con packwiz_url
    "ignored" => array(),
    "packwiz_url" => "https://TU-DOMINIO/files/instances/MiInstanciaNueva/pack.toml",
    "whitelist" => array(),
    "whitelistActive" => false,
    "status" => array(
        "nameServer" => "MiInstanciaNueva",
        "ip" => "ip.de.tu.server",
        "port" => 25565
    )
));
```

**⚠️ `"verify" => false` es obligatorio en instancias con `packwiz_url`.** Si lo dejas en `true`, `minecraft-java-core` va a borrar los mods que packwiz instaló cada vez que alguien juegue (piensa que son archivos "extra" que no reconoce).

### Campos importantes
| Campo | Qué es |
|---|---|
| `loadder.minecraft_version` / `loadder_type` / `loadder_version` | Deben coincidir con lo que pusiste en `packwiz init` |
| `packwiz_url` | URL pública al `pack.toml` de esta instancia |
| `verify` | `false` siempre que uses `packwiz_url` |
| `whitelistActive` | `true` si solo ciertos jugadores pueden entrar (usa `whitelist`) |
| `status.ip` / `status.port` | El server de Minecraft al que se conecta esta instancia |

## 5. Subir todo a tu servidor

Sube la carpeta `files/instances/MiInstanciaNueva/` completa (con `pack.toml`, `index.toml`, `mods/*.pw.toml`) y el `instances.php` actualizado a tu hosting real.

## 6. Verificar

1. Abre en el navegador `https://TU-DOMINIO/files/instances/MiInstanciaNueva/pack.toml` — debe mostrarte el texto del pack, no un 404.
2. Abre el launcher → pestaña **Instancias** → debe aparecer la card nueva.
3. Selecciónala y dale **Jugar** — deberías ver "Actualizando mods…" en el footer mientras packwiz descarga los mods, y luego el juego arranca normal.

---

## Actualizar mods de una instancia que ya existe

```bash
cd files/instances/MiInstanciaNueva
packwiz update <mod>       # actualizar uno
packwiz update --all       # actualizar todos
packwiz modrinth install <mod>   # agregar uno nuevo
packwiz remove <mod>       # quitar uno
```

No hace falta tocar `instances.php` para esto — el jugador recibe el cambio automáticamente la próxima vez que le dé Jugar (packwiz compara por hash contra lo que ya tiene instalado).

## Comandos packwiz más usados

```bash
packwiz init                     # crear pack nuevo
packwiz refresh                  # reindexar (después de copiar un jar a mano)
packwiz modrinth install <mod>   # agregar mod de Modrinth
packwiz curseforge install <mod> # agregar mod de CurseForge
packwiz update <mod>              # actualizar un mod
packwiz update --all              # actualizar todos
packwiz list                      # ver todos los mods del pack
packwiz remove <mod>               # quitar un mod
```

Alias cortos: `packwiz mr` = `packwiz modrinth`, `packwiz cf` = `packwiz curseforge`.
