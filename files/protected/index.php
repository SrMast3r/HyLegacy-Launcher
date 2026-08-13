<?php
// Contenido cifrado en reposo, servido únicamente por ephemeral.php.
// Nunca directamente por el webserver, aunque el listado de directorios
// esté mal configurado en el hosting.
http_response_code(403);
exit;
