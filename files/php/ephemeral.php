<?php
// Entrega en caliente de mods protegidos: descifra el .enc guardado en
// files/protected/ y lo vuelve a cifrar con una clave/IV de un solo uso
// antes de responder, para que el par clave+contenido nunca quede fijo
// en ningún punto salvo esta respuesta puntual. El launcher es quien
// descifra y escribe el .jar plano justo antes de lanzar (ver
// src/assets/js/utils/ephemeralMods.js), y lo borra apenas arranca el juego.
header("Content-Type: application/json; charset=UTF-8");
require_once __DIR__ . '/ephemeral_db.php';
require_once __DIR__ . '/scandir.php';

// instances.php espera que $instance ya tenga una entrada por carpeta real
// (mismo patrón que index.php) antes de mezclarle sus campos extra.
$instance = array();
foreach (scanFolder(__DIR__ . '/../instances') as $value) {
    $instance[$value] = array('name' => $value);
}
require_once __DIR__ . '/instances.php';

const RATE_LIMIT_WINDOW_SECONDS = 300;
const RATE_LIMIT_MAX_REQUESTS = 30;

function ephemeralFail($code, $message) {
    http_response_code($code);
    echo json_encode(array('error' => $message));
    exit;
}

$config = ephemeralConfig();
if (!$config['client_key']) {
    ephemeralFail(500, 'Servidor mal configurado: falta ephemeral_secret.php (ver ephemeral_secret.php.example)');
}

$providedKey = $_SERVER['HTTP_X_CLIENT_KEY'] ?? '';
if (!$providedKey || !hash_equals($config['client_key'], $providedKey)) {
    ephemeralFail(401, 'Clave de cliente inválida');
}

$action = $_GET['action'] ?? '';
if ($action !== 'fetch') {
    ephemeralFail(400, 'Acción desconocida');
}

$instanceName = $_GET['instance'] ?? '';
if (!$instanceName || !isset($instance[$instanceName])) {
    ephemeralFail(404, 'Instancia desconocida');
}

// Autoritativo: qué mods efímeros tiene esta instancia lo decide el
// servidor (instances.php), nunca lo que pida el cliente en la query.
$modIds = $instance[$instanceName]['ephemeral_mods'] ?? array();
if (!$modIds) {
    ephemeralFail(404, 'Esta instancia no tiene mods efímeros configurados');
}

$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$now = time();

try {
    $db = ephemeralDb();
} catch (Exception $e) {
    ephemeralFail(500, 'No se pudo abrir el almacén de mods efímeros');
}

// Rate limit simple por IP, sin infraestructura nueva (cuenta filas recientes).
$rateStmt = $db->prepare('SELECT COUNT(*) FROM issuance_log WHERE ip = :ip AND created_at > :since');
$rateStmt->execute(array(':ip' => $ip, ':since' => $now - RATE_LIMIT_WINDOW_SECONDS));
if ((int)$rateStmt->fetchColumn() >= RATE_LIMIT_MAX_REQUESTS) {
    ephemeralFail(429, 'Demasiadas solicitudes, intenta de nuevo en unos minutos');
}

$files = array();
$modStmt = $db->prepare('SELECT id, filename, key_hex FROM protected_mods WHERE id = :id');
$logStmt = $db->prepare('INSERT INTO issuance_log (mod_id, instance, ip, created_at) VALUES (:mod_id, :instance, :ip, :created_at)');

foreach ($modIds as $modId) {
    $modStmt->execute(array(':id' => $modId));
    $mod = $modStmt->fetch(PDO::FETCH_ASSOC);
    if (!$mod) {
        ephemeralFail(500, "Mod protegido '$modId' configurado pero no publicado (falta encrypt-mod.php)");
    }

    $encPath = __DIR__ . '/../protected/' . $mod['id'] . '.enc';
    if (!file_exists($encPath)) {
        ephemeralFail(500, "Falta el archivo cifrado de '$modId'");
    }

    $raw = file_get_contents($encPath);
    $iv = substr($raw, 0, 12);
    $tag = substr($raw, 12, 16);
    $ciphertext = substr($raw, 28);

    $storedKey = hex2bin($mod['key_hex']);
    $plaintext = openssl_decrypt($ciphertext, 'aes-256-gcm', $storedKey, OPENSSL_RAW_DATA, $iv, $tag);
    if ($plaintext === false) {
        ephemeralFail(500, "No se pudo descifrar '$modId' (contenido corrupto)");
    }

    // Clave/IV de un solo uso para ESTA respuesta — nunca se reutiliza ni se guarda.
    $sessionKey = random_bytes(32);
    $sessionIv = random_bytes(12);
    $sessionTag = '';
    $reEncrypted = openssl_encrypt($plaintext, 'aes-256-gcm', $sessionKey, OPENSSL_RAW_DATA, $sessionIv, $sessionTag);

    $files[] = array(
        'id' => $mod['id'],
        'filename' => $mod['filename'],
        'key' => base64_encode($sessionKey),
        'iv' => base64_encode($sessionIv),
        'tag' => base64_encode($sessionTag),
        'ciphertext' => base64_encode($reEncrypted),
    );

    $logStmt->execute(array(':mod_id' => $modId, ':instance' => $instanceName, ':ip' => $ip, ':created_at' => $now));
}

echo json_encode(array('files' => $files));
?>
