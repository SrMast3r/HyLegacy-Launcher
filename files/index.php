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
    foreach ($instances_list as $value) {
        if (substr($_SERVER['REQUEST_URI'], -1) == '/') {
            $_SERVER['REQUEST_URI'] = substr($_SERVER['REQUEST_URI'], 0, -1);
        }

        $url = "$scheme://$_SERVER[HTTP_HOST]$_SERVER[REQUEST_URI]?instance=$value";
        $instance[$value] = array("name" => $value, "url" => $url);
    }
    
    include 'php/instances.php';
    echo str_replace("\\", "", json_encode($instance));
    exit;
}

echo dirToArray("instances/$instance_param");
?>