<?php
// Acceso compartido a la base SQLite del sistema de mods efímeros
// (claves de contenido cifrado + registro de emisiones para rate-limit/abuso).
// Usado tanto por ephemeral.php (runtime) como por tools/encrypt-mod.php (publicación).

function ephemeralDb() {
    $path = __DIR__ . '/../data/ephemeral.sqlite';
    $pdo = new PDO('sqlite:' . $path);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec('CREATE TABLE IF NOT EXISTS protected_mods (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        key_hex TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS issuance_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mod_id TEXT NOT NULL,
        instance TEXT NOT NULL,
        ip TEXT NOT NULL,
        created_at INTEGER NOT NULL
    )');
    return $pdo;
}

function ephemeralConfig() {
    $secretFile = __DIR__ . '/ephemeral_secret.php';
    $clientKey = getenv('EPHEMERAL_CLIENT_KEY');
    if (!$clientKey && file_exists($secretFile)) {
        $secret = include $secretFile;
        $clientKey = $secret['client_key'] ?? null;
    }
    return array('client_key' => $clientKey);
}
?>
