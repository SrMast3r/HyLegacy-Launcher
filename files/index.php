<?php
header("Content-Type: application/json; charset=UTF-8");
include 'php/scandir.php';

$instance_param = $_GET['instance'] ?? 'null';

if ($instance_param == '/' || $instance_param[0] == '.') {
    echo json_encode([]);
    exit;
} 

if (!file_exists('instances')) {
    echo dirToArray("files");
    exit;
} 

if ($instance_param == 'null') {
    $instances_list = scanFolder("instances");
    $instance = array();
    // Detrás de Cloudflare, nginx solo ve HTTP (Cloudflare termina el TLS);
    // sin esto, las URLs devueltas al cliente forzarían http:// incluso
    // cuando el jugador está en https://.
    $scheme = requestScheme();
    // PHP_SELF es la ruta sin query string (REQUEST_URI ya trae
    // "?instance=null" pegado, y volver a agregar "?instance=$value"
    // encima de eso dejaba URLs con dos "?" -- rompía la detección de
    // "esta es una instancia específica, no el listado maestro" del lado
    // del servidor, y minecraft-java-core (que arma sus propias peticiones
    // sin poder mandar headers custom) se quedaba colgado con eso.
    foreach ($instances_list as $value) {
        $url = "$scheme://$_SERVER[HTTP_HOST]$_SERVER[PHP_SELF]?instance=$value";
        $instance[$value] = array("name" => $value, "url" => $url);
    }
    
    include 'php/instances.php';
    echo str_replace("\\", "", json_encode($instance));
    exit;
}

echo dirToArray("instances/$instance_param");
?>