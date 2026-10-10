<?php

// La versión de Minecraft, el loader y los mods salen del .mrpack de cada
// carpeta (ver php/mrpack.php). Aquí solo va la imagen, el servidor y la whitelist.

$instance['PeruLand'] = array_merge($instance['PeruLand'], array(
    "image" => "https://i.imgur.com/djZ5pQS.jpeg",
    "whitelist" => array(),
    "whitelistActive" => false,
    "status" => array(
        "nameServer" => "PeruLand",
        "ip" => "23.137.104.203",
        "port" => 1120
    )
));
?>
