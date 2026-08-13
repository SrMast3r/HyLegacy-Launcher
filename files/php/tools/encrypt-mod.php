<?php
// Script de publicación — correrlo a mano cada vez que se agrega o
// actualiza un mod protegido. Cifra el .jar y lo guarda en files/protected/,
// guarda la clave en la base SQLite, y borra el original de mods/ (el lugar
// donde hoy se filtra en texto plano).
//
// Uso: php encrypt-mod.php <ruta-al-jar> <mod-id>
// Ejemplo: php encrypt-mod.php ../../instances/lockout/mods/lockout-client-1.0.0.jar lockout-client

require_once __DIR__ . '/../ephemeral_db.php';

if (php_sapi_name() !== 'cli') {
    http_response_code(403);
    exit('Solo se puede ejecutar desde la línea de comandos.');
}

if ($argc < 3) {
    fwrite(STDERR, "Uso: php encrypt-mod.php <ruta-al-jar> <mod-id>\n");
    exit(1);
}

$jarPath = $argv[1];
$modId = $argv[2];

if (!file_exists($jarPath)) {
    fwrite(STDERR, "No existe el archivo: $jarPath\n");
    exit(1);
}
if (!preg_match('/^[a-z0-9-]+$/', $modId)) {
    fwrite(STDERR, "mod-id inválido (solo minúsculas, números y guiones): $modId\n");
    exit(1);
}

$plaintext = file_get_contents($jarPath);
$filename = basename($jarPath);

$key = random_bytes(32);
$iv = random_bytes(12);
$tag = '';
$ciphertext = openssl_encrypt($plaintext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
if ($ciphertext === false) {
    fwrite(STDERR, "Fallo al cifrar.\n");
    exit(1);
}

$protectedDir = __DIR__ . '/../../protected';
if (!is_dir($protectedDir)) mkdir($protectedDir, 0755, true);

$encPath = $protectedDir . '/' . $modId . '.enc';
file_put_contents($encPath, $iv . $tag . $ciphertext);

$db = ephemeralDb();
$stmt = $db->prepare('INSERT INTO protected_mods (id, filename, key_hex, updated_at)
    VALUES (:id, :filename, :key_hex, :updated_at)
    ON CONFLICT(id) DO UPDATE SET filename = :filename, key_hex = :key_hex, updated_at = :updated_at');
$stmt->execute(array(
    ':id' => $modId,
    ':filename' => $filename,
    ':key_hex' => bin2hex($key),
    ':updated_at' => time(),
));

echo "OK: '$modId' cifrado en $encPath (" . strlen($ciphertext) . " bytes)\n";
echo "Filename registrado: $filename\n";
echo "\nAhora agrega \"ephemeral_mods\" => array(\"$modId\") a la instancia correspondiente en instances.php,\n";
echo "y borra manualmente el original en texto plano:\n  $jarPath\n";
?>
