<?php
/**
 * Сколько человек играет прямо сейчас. Читает то, что накопил ping.php.
 * Ничего не пишет, поэтому его можно дёргать с сайта хоть каждую минуту.
 *
 * Файл кладётся в public_html/api/stats.php
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store');

const ALIVE_SECONDS = 300;

$dataFile = __DIR__ . '/data/online.json';
$now      = time();

$list = [];
if (is_file($dataFile)) {
    $raw    = @file_get_contents($dataFile);
    $parsed = json_decode($raw ?: '{}', true);
    if (is_array($parsed)) { $list = $parsed; }
}

$online = 0;
$latest = 0;
foreach ($list as $seen) {
    if ($now - $seen <= ALIVE_SECONDS) { $online++; }
    if ($seen > $latest) { $latest = $seen; }
}

echo json_encode([
    'online'    => $online,
    // когда последний раз кто-то отмечался — чтобы отличить «никто не играет»
    // от «сбор данных сломался»
    'lastSeen'  => $latest ?: null,
    'updatedAt' => $now,
]);
