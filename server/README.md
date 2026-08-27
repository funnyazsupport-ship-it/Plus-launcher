# Релей

Ставится на любую машину с постоянным адресом. Задача одна: выставить наружу мир,
открытый дома, — туда, куда домашний роутер никого не пускает.

Зависимостей нет, нужен только Node.js. Файл `relay.js` кладётся как есть.

## Учётки

Человек заводит ник с паролем, друзья добавляют его по нику — адрес диктовать
не приходится. Порт закрепляется за ником **навсегда**: если бы он выдавался
заново каждый раз, запись в списке серверов у друга протухала бы после каждого
перезапуска игры.

Учётки лежат в `RELAY_DATA` (по умолчанию `/var/lib/relay/accounts.json`).
Пароли хранятся как scrypt-свёртка с солью. Папка должна быть доступна на
запись пользователю, под которым идёт служба:

```sh
sudo mkdir -p /var/lib/relay && sudo chown nobody:nogroup /var/lib/relay
```

Число учёток ограничено промежутком портов: `RELAY_PORT_TO - RELAY_PORT_FROM + 1`.

## Порты

| Порт | Кто приходит |
|---|---|
| `7000` | лаунчер хозяина: управляющее соединение и соединения для данных |
| `25565–25584` | друзья |

Настраивается переменными окружения: `RELAY_PORT`, `RELAY_KEY`,
`RELAY_PORT_FROM`, `RELAY_PORT_TO`.

`RELAY_KEY` — ключ самого сервера, его нужно знать, чтобы завести на нём ник.
Пустой означает «пускать всех»: тогда любой, кто узнает адрес, сможет занять
место. Лучше задать. К паролям от ников он отношения не имеет.

## Установка

```sh
sudo apt update && sudo apt install -y nodejs
sudo mkdir -p /opt/relay && sudo cp relay.js /opt/relay/
```

Служба, чтобы поднимался сам после перезагрузки:

```sh
sudo tee /etc/systemd/system/relay.service >/dev/null <<'EOF'
[Unit]
Description=Plus Launcher relay
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/relay/relay.js
Environment=RELAY_KEY=ЗАМЕНИТЬ_НА_СВОЙ_ПАРОЛЬ
Restart=always
RestartSec=5
User=nobody

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now relay
sudo systemctl status relay
```

## Файрвол

Пускать снаружи придётся дважды — это то место, где обычно всё и встаёт.

**1. В панели Oracle.** Networking → Virtual Cloud Networks → ваша сеть →
Security Lists → Default Security List → Add Ingress Rules. Два правила,
Source CIDR `0.0.0.0/0`, IP Protocol `TCP`:

- Destination Port Range: `7000`
- Destination Port Range: `25565-25584`

**2. На самой машине.** Образы Oracle приезжают с закрытым по умолчанию
iptables — про это забывают чаще всего, и снаружи всё выглядит так, будто
сервер мёртв:

```sh
sudo iptables -I INPUT 6 -p tcp --dport 7000 -j ACCEPT
sudo iptables -I INPUT 6 -p tcp --dport 25565:25584 -j ACCEPT
sudo netfilter-persistent save
```

## Проверка

```sh
sudo journalctl -u relay -f
```

Когда лаунчер подключится, в журнале появится `<ник> вышел на связь, порт 25565`.
Друзьям адрес не нужен — они добавляют по нику.
