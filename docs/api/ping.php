<?php
/**
 * Отметка «я сейчас играю».
 *
 * Лаунчер шлёт сюда запрос, пока идёт игра. Храним только случайный
 * идентификатор установки и время последней отметки — ни ника, ни IP,
 * ни версии игры. По этим данным нельзя понять, кто именно играет.
 *
 * Файл кладётся в public_html/api/ping.php
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'only POST']);
    exit;
}

// Сколько секунд отметка считается свежей. Лаунчер шлёт раз в минуту,
// поэтому пяти минут хватает, чтобы пережить пропущенный запрос.
const ALIVE_SECONDS = 300;
const MAX_RECORDS   = 20000;   // защита от разрастания файла

$dataDir  = __DIR__ . '/data';
$dataFile = $dataDir . '/online.json';

$body = json_decode(file_get_contents('php://input'), true);
$id   = isset($body['id']) ? (string) $body['id'] : '';

// принимаем только то, что сами и генерируем: 32 шестнадцатеричных знака
if (!preg_match('/^[a-f0-9]{32}$/', $id)) {
    http_response_code(400);
    echo json_encode(['error' => 'bad id']);
    exit;
}

if (!is_dir($dataDir)) { @mkdir($dataDir, 0755, true); }

$now = time();
$fp  = @fopen($dataFile, 'c+');
if ($fp === false) {
    http_response_code(500);
    echo json_encode(['error' => 'storage unavailable']);
    exit;
}

// блокировка: запросов может прийти несколько разом, иначе файл перезапишут друг поверх друга
flock($fp, LOCK_EX);
$raw  = stream_get_contents($fp);
$list = json_decode($raw ?: '{}', true);
if (!is_array($list)) { $list = []; }

$list[$id] = $now;

// выкидываем протухшие отметки, а если записей всё равно слишком много — самые старые
foreach ($list as $key => $seen) {
    if ($now - $seen > ALIVE_SECONDS) { unset($list[$key]); }
}
if (count($list) > MAX_RECORDS) {
    asort($list);
    $list = array_slice($list, -MAX_RECORDS, null, true);
}

ftruncate($fp, 0);
rewind($fp);
fwrite($fp, json_encode($list));
fflush($fp);
flock($fp, LOCK_UN);
fclose($fp);

echo json_encode(['ok' => true, 'online' => count($list)]);
