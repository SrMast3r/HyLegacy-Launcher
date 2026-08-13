<?php
// Detrás de Cloudflare (u otro proxy que termine TLS), nginx solo ve HTTP —
// hay que confiar en X-Forwarded-Proto para saber el esquema real que usó
// el cliente, si no todas las URLs que arma el servidor quedan en http://.
function requestScheme() {
    if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') return 'https';
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') return 'https';
    return 'http';
}

// Archivos propios de packwiz: minecraft-java-core no debe verlos ni intentar
// descargarlos por su cuenta — packwiz-installer-bootstrap los maneja aparte,
// directo desde el pack.toml (ver packwiz_url en instances.php).
function isPackwizFile($filename) {
    if ($filename === 'pack.toml' || $filename === 'index.toml' || $filename === 'packwiz.json') return true;
    if (substr($filename, -8) === '.pw.toml') return true;
    return false;
}

function scanAllDir($dir) {
    $result = [];
    foreach(scandir($dir) as $filename) {
        if ($filename[0] === '.') continue;
        if (isPackwizFile($filename)) continue;
        $filePath = $dir . '/' . $filename;
        if (is_dir($filePath)) {
            foreach (scanAllDir($filePath) as $childFilename) {
                $result[] = $filename . '/' . $childFilename;
            }
        } else {
            $result[] = $filename;
        }
    }
    return $result;
}

function scanFolder($dir) {
    $result = [];
    foreach(scandir($dir) as $filename) {
        if ($filename[0] === '.') continue;
        $filePath = $dir . '/' . $filename;
        if ($filename == "php") continue;
        if (is_dir($filePath)) $result[] = $filename;
        
    }
    return $result;
}

function dirToArray($dir) {
    $res = [];
    $cdir = scanAllDir($dir);
    foreach ($cdir as $key => $value) {
        $hash = hash_file('sha1', $dir . "/" . $value);
        $size = filesize($dir . "/" . $value);
        $path = str_replace("$dir/", "", $dir . "/" . $value);
            
        $url_req = parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH);
        $scheme = requestScheme();
        $url = "$scheme://$_SERVER[HTTP_HOST]$url_req$dir/$path";
        $res[] = array("url" => $url, "size" => $size, "hash" => $hash, "path" => $path);     
    }
    return str_replace("\\", "", json_encode($res)); 
}
?>