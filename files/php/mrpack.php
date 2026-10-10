<?php
// Instancias basadas en un .mrpack de Modrinth: basta con subir el archivo
// exportado a files/instances/<Nombre>/ y el launcher hace el resto (baja los
// mods del CDN de Modrinth y aplica los overrides). Aquí solo se anuncia la URL
// del pack y se leen de su modrinth.index.json la versión de Minecraft y el
// loader, para no tener que escribirlos a mano en instances.php.

function findMrpack($dir) {
    if (!is_dir($dir)) return null;
    $packs = [];
    foreach (scandir($dir) as $filename) {
        if ($filename[0] === '.') continue;
        if (strtolower(substr($filename, -7)) === '.mrpack' && is_file("$dir/$filename")) $packs[] = $filename;
    }
    if (!$packs) return null;
    // Si hay varios, se usa el más reciente
    usort($packs, function ($a, $b) use ($dir) { return filemtime("$dir/$b") - filemtime("$dir/$a"); });
    return $packs[0];
}

// modrinth.index.json del pack, cacheado en un .json oculto junto al pack
// (se regenera cuando cambia el .mrpack) para no abrir el zip en cada petición.
function readMrpackIndex($file) {
    $cache = dirname($file) . '/.mrpack-cache.json';
    $key = filesize($file) . '-' . filemtime($file);
    if (is_file($cache)) {
        $cached = json_decode(file_get_contents($cache), true);
        // Una caché sin dependencies es de cuando faltaba php-zip: se rehace
        if (($cached['key'] ?? null) === $key && (isset($cached['dependencies']) || !class_exists('ZipArchive'))) return $cached;
    }

    $info = array('key' => $key, 'sha1' => hash_file('sha1', $file));
    if (class_exists('ZipArchive')) {
        $zip = new ZipArchive();
        if ($zip->open($file) === true) {
            $index = json_decode($zip->getFromName('modrinth.index.json'), true);
            $zip->close();
            if (is_array($index)) {
                $info['name'] = $index['name'] ?? null;
                $info['versionId'] = $index['versionId'] ?? null;
                $info['dependencies'] = $index['dependencies'] ?? array();
            }
        }
    }
    @file_put_contents($cache, json_encode($info));
    return $info;
}

// Campos que se mezclan en la instancia. instances.php se aplica después y
// puede sobrescribir cualquiera (imagen, IP, whitelist o incluso el loader).
function mrpackInstanceData($instanceDir, $baseUrl) {
    $pack = findMrpack($instanceDir);
    if (!$pack) return null;

    $info = readMrpackIndex("$instanceDir/$pack");
    $data = array(
        "mrpack_url" => "$baseUrl/" . rawurlencode($pack),
        "mrpack_sha1" => $info['sha1'],
        "verify" => false,
        "ignored" => array(),
    );
    if (!empty($info['versionId'])) $data["mrpack_version"] = $info['versionId'];

    $deps = $info['dependencies'] ?? array();
    if (!empty($deps['minecraft'])) {
        $loaders = array(
            'fabric-loader' => 'fabric',
            'quilt-loader' => 'quilt',
            'neoforge' => 'neoforge',
            'forge' => 'forge',
        );
        $type = 'none';
        $version = '';
        foreach ($loaders as $dep => $name) {
            if (!empty($deps[$dep])) { $type = $name; $version = $deps[$dep]; break; }
        }
        // Forge en minecraft-java-core espera "<mc>-<forge>"
        if ($type === 'forge' && strpos($version, $deps['minecraft'] . '-') !== 0) {
            $version = $deps['minecraft'] . '-' . $version;
        }
        $data["loadder"] = array(
            "minecraft_version" => $deps['minecraft'],
            "loadder_type" => $type,
            "loadder_version" => $version,
        );
    }
    return $data;
}
?>
