'use strict';
/*
 * Переводы интерфейса.
 *
 * Ключ — русская строка прямо из вёрстки, значение — пара [английский, украинский].
 * Так не нужно расставлять data-i18n по всей разметке: перевод ищется по самому тексту,
 * а чего нет в словаре, остаётся по-русски — интерфейс не ломается от пропущенной строки.
 */
const LANGS = [
  { id: 'ru', name: 'Русский' },
  { id: 'en', name: 'English' },
  { id: 'uk', name: 'Українська' },
];

const I = { en: 0, uk: 1 };

const DICT = {
  // ---- навигация и общее ----
  'Играть': ['Play', 'Грати'],
  'ИГРАТЬ': ['PLAY', 'ГРАТИ'],
  'ОСТАНОВИТЬ': ['STOP', 'ЗУПИНИТИ'],
  'Версии': ['Versions', 'Версії'],
  'Моды': ['Mods', 'Моди'],
  'Скины': ['Skins', 'Скіни'],
  'Аккаунт': ['Account', 'Акаунт'],
  'Настройки': ['Settings', 'Налаштування'],
  'Консоль': ['Console', 'Консоль'],
  'Помощник': ['Assistant', 'Помічник'],
  'ПОМОЩНИК': ['ASSISTANT', 'ПОМІЧНИК'],
  'Свернуть': ['Minimize', 'Згорнути'],
  'Развернуть': ['Maximize', 'Розгорнути'],
  'Закрыть': ['Close', 'Закрити'],
  'Отмена': ['Cancel', 'Скасувати'],
  'Открыть': ['Open', 'Відкрити'],
  'Обзор': ['Browse', 'Огляд'],
  'Найти': ['Find', 'Знайти'],
  'Готово': ['Done', 'Готово'],
  'Позже': ['Later', 'Пізніше'],
  'Добавить': ['Add', 'Додати'],
  'Изменить': ['Change', 'Змінити'],
  'Установить': ['Install', 'Встановити'],
  'Установлено': ['Installed', 'Встановлено'],
  'Очистить': ['Clear', 'Очистити'],
  'Скопировать': ['Copy', 'Копіювати'],
  'Скопировано': ['Copied', 'Скопійовано'],
  'Удалено': ['Removed', 'Видалено'],
  'Папка': ['Folder', 'Тека'],
  'Цвет': ['Colour', 'Колір'],
  'Название': ['Name', 'Назва'],
  'Сборка': ['Instance', 'Збірка'],
  'Сборки': ['Instances', 'Збірки'],
  'Показать ещё': ['Show more', 'Показати ще'],
  'пусто': ['empty', 'порожньо'],
  'нет сборки': ['no instance', 'немає збірки'],
  'МБ': ['MB', 'МБ'],
  'КБ': ['KB', 'КБ'],
  'ГБ': ['GB', 'ГБ'],
  'ТБ': ['TB', 'ТБ'],
  'Б': ['B', 'Б'],

  // ---- страница «Играть» ----
  'Каждая версия живёт в своей папке со своими модами': [
    'Every version lives in its own folder with its own mods',
    'Кожна версія живе у власній теці зі своїми модами'],
  'Новая сборка': ['New instance', 'Нова збірка'],
  'Сборок пока нет': ['No instances yet', 'Збірок поки немає'],
  'Соберите любую версию — от alpha 2010 года до свежих снапшотов.': [
    'Build any version — from 2010 alphas to the newest snapshots.',
    'Зберіть будь-яку версію — від alpha 2010 року до свіжих знімків.'],
  'Создать первую': ['Create the first one', 'Створити першу'],
  'сборка не выбрана': ['no instance selected', 'збірку не вибрано'],
  'не запускали': ['never played', 'не запускали'],
  'только что': ['just now', 'щойно'],
  'Сборка удалена': ['Instance deleted', 'Збірку видалено'],
  'Игра не запущена': ['The game is not running', 'Гра не запущена'],
  'Игра остановлена': ['Game stopped', 'Гру зупинено'],
  'Игра закрыта': ['Game closed', 'Гру закрито'],

  // ---- создание сборки ----
  'Все версии Mojang, Fabric, Quilt, Forge и NeoForge': [
    'Every Mojang version plus Fabric, Quilt, Forge and NeoForge',
    'Усі версії Mojang, Fabric, Quilt, Forge та NeoForge'],
  'Выживание с модами': ['Modded survival', 'Виживання з модами'],
  'Тип версий': ['Version type', 'Тип версій'],
  'Релизы': ['Releases', 'Релізи'],
  'Снапшоты': ['Snapshots', 'Знімки'],
  'Все': ['All', 'Усі'],
  'Версия Minecraft': ['Minecraft version', 'Версія Minecraft'],
  'Загрузчик': ['Mod loader', 'Завантажувач'],
  'Без модов': ['No mods', 'Без модів'],
  'без модов (ваниль)': ['no mods (vanilla)', 'без модів (ваніль)'],
  'Версия загрузчика': ['Loader version', 'Версія завантажувача'],
  'Выберите версию Minecraft': ['Choose a Minecraft version', 'Оберіть версію Minecraft'],
  'Для этой версии нет сборок загрузчика': [
    'No loader builds for this version', 'Для цієї версії немає збірок завантажувача'],
  'нет версий': ['no versions', 'немає версій'],
  'нет сборок': ['no instances', 'немає збірок'],
  'нет сборок для этой версии': ['no instances for this version', 'немає збірок для цієї версії'],
  'загрузка…': ['loading…', 'завантаження…'],
  'Список версий Mojang недоступен — проверьте интернет': [
    'Mojang version list is unavailable — check your connection',
    'Список версій Mojang недоступний — перевірте інтернет'],

  // ---- моды ----
  'Каталог': ['Catalogue', 'Каталог'],
  'Modrinth и CurseForge в одном списке': [
    'Modrinth and CurseForge in one list', 'Modrinth і CurseForge в одному списку'],
  'Ресурспаки': ['Resource packs', 'Ресурспаки'],
  'Шейдеры': ['Shaders', 'Шейдери'],
  'Модпаки': ['Modpacks', 'Модпаки'],
  'Датапаки': ['Data packs', 'Датапаки'],
  'Оба источника': ['Both sources', 'Обидва джерела'],
  'Релевантность': ['Relevance', 'Релевантність'],
  'Загрузки': ['Downloads', 'Завантаження'],
  'Обновление': ['Updated', 'Оновлення'],
  'Новинки': ['Newest', 'Новинки'],
  'Сначала выберите сборку': ['Select an instance first', 'Спершу оберіть збірку'],
  'Сначала создайте сборку': ['Create an instance first', 'Спершу створіть збірку'],
  'ничего не найдено': ['nothing found', 'нічого не знайдено'],
  'нет совместимых версий': ['no compatible versions', 'немає сумісних версій'],
  'не удалось получить версии': ['could not load versions', 'не вдалося отримати версії'],
  'поиск…': ['searching…', 'пошук…'],
  'загрузка версий…': ['loading versions…', 'завантаження версій…'],
  'Включить/выключить': ['Enable / disable', 'Увімкнути / вимкнути'],
  'Удалить': ['Delete', 'Видалити'],

  // ---- скины ----
  'Загрузка на лицензию Microsoft и локальные скины для оффлайна': [
    'Upload to a Microsoft licence, or local skins for offline play',
    'Завантаження на ліцензію Microsoft і локальні скіни для офлайну'],
  'Добавить PNG': ['Add PNG', 'Додати PNG'],
  'Библиотека': ['Library', 'Бібліотека'],
  'Библиотека пуста — добавьте PNG 64x64': [
    'Library is empty — add a 64x64 PNG', 'Бібліотека порожня — додайте PNG 64x64'],
  'скин не выбран': ['no skin selected', 'скін не вибрано'],
  'Применить скин': ['Apply skin', 'Застосувати скін'],
  'Сбросить на стандартный': ['Reset to default', 'Скинути на стандартний'],
  'Удалить из библиотеки': ['Remove from library', 'Видалити з бібліотеки'],
  'Поставить локально': ['Apply locally', 'Встановити локально'],
  'Установить CustomSkinLoader': ['Install CustomSkinLoader', 'Встановити CustomSkinLoader'],
  'CustomSkinLoader установлен': ['CustomSkinLoader installed', 'CustomSkinLoader встановлено'],
  'CustomSkinLoader установлен — локальные скины заработают после запуска игры.': [
    'CustomSkinLoader is installed — local skins will work after you start the game.',
    'CustomSkinLoader встановлено — локальні скіни запрацюють після запуску гри.'],
  'Плащи': ['Capes', 'Плащі'],
  'плащей нет': ['no capes', 'плащів немає'],
  'без плаща': ['no cape', 'без плаща'],
  'Плащ спрятан': ['Cape hidden', 'Плащ приховано'],
  'доступны только для лицензии': ['licence accounts only', 'лише для ліцензії'],
  'Сначала выберите скин': ['Choose a skin first', 'Спершу оберіть скін'],
  'не удалось прочитать PNG': ['could not read the PNG', 'не вдалося прочитати PNG'],
  'Скин загружен на аккаунт Mojang': ['Skin uploaded to your Mojang account', 'Скін завантажено на акаунт Mojang'],
  'Скин сброшен': ['Skin reset', 'Скін скинуто'],
  'Скин положен в папку версии': ['Skin saved into the instance folder', 'Скін покладено в теку версії'],
  'Сброс работает только для лицензии Microsoft': [
    'Reset works only for a Microsoft licence', 'Скидання працює лише для ліцензії Microsoft'],
  'Сервера скинов не знают оффлайн-ник, поэтому скин показывает мод CustomSkinLoader — он берёт PNG из папки версии. Выберите сборку и примените скин.': [
    'Skin servers do not know offline nicknames, so the CustomSkinLoader mod shows your skin — it reads the PNG from the instance folder. Pick an instance and apply the skin.',
    'Сервери скінів не знають офлайн-нік, тому скін показує мод CustomSkinLoader — він бере PNG із теки версії. Оберіть збірку та застосуйте скін.'],
  'Скин записан. Осталось установить CustomSkinLoader — кнопка ниже.': [
    'Skin saved. Now install CustomSkinLoader with the button below.',
    'Скін записано. Лишилося встановити CustomSkinLoader — кнопка нижче.'],
  'Скин записан, CustomSkinLoader на месте — в игре он уже будет виден.': [
    'Skin saved, CustomSkinLoader is in place — it will show up in game.',
    'Скін записано, CustomSkinLoader на місці — у грі він уже буде видно.'],
  'Скин записан, но в сборке без загрузчика мод скинов не поставить — игра покажет стандартного Стива.': [
    'Skin saved, but a vanilla instance cannot take the skin mod — the game will show the default Steve.',
    'Скін записано, але у збірці без завантажувача мод скінів не встановити — гра покаже стандартного Стіва.'],

  // ---- аккаунт ----
  'Ely.by или оффлайн-профиль': ['Ely.by or an offline profile', 'Ely.by або офлайн-профіль'],
  // вход через Microsoft пока убран из интерфейса, строки оставлены для возврата панели
  'Лицензия Microsoft или оффлайн-профиль': [
    'Microsoft licence or an offline profile', 'Ліцензія Microsoft або офлайн-профіль'],
  'Лицензия Microsoft': ['Microsoft licence', 'Ліцензія Microsoft'],
  'Вход по коду устройства. Нужна купленная Minecraft: Java Edition.': [
    'Device code sign-in. Requires a purchased Minecraft: Java Edition.',
    'Вхід за кодом пристрою. Потрібна придбана Minecraft: Java Edition.'],
  'Войти через Microsoft': ['Sign in with Microsoft', 'Увійти через Microsoft'],
  'Откройте': ['Open', 'Відкрийте'],
  'и введите код': ['and enter the code', 'та введіть код'],
  'Код скопирован': ['Code copied', 'Код скопійовано'],
  'Вход выполнен': ['Signed in', 'Вхід виконано'],
  'Оффлайн-профиль': ['Offline profile', 'Офлайн-профіль'],
  'Одиночная игра и сервера без лицензии. Скин можно поставить локально во вкладке «Скины».': [
    'Singleplayer and servers without a licence. You can apply a skin locally on the Skins tab.',
    'Одиночна гра та сервери без ліцензії. Скін можна встановити локально у вкладці «Скіни».'],
  'Ник': ['Nickname', 'Нік'],
  'Введите ник': ['Enter a nickname', 'Введіть нік'],
  'Профили': ['Profiles', 'Профілі'],
  'профилей нет': ['no profiles', 'профілів немає'],
  'нет профиля': ['no profile', 'немає профілю'],
  'Нет профиля': ['No profile', 'Немає профілю'],
  'не выполнен вход': ['not signed in', 'вхід не виконано'],
  'лицензия': ['licence', 'ліцензія'],
  'оффлайн': ['offline', 'офлайн'],
  'Профиль добавлен': ['Profile added', 'Профіль додано'],
  'Профиль не выбран — зайдите во вкладку «Аккаунт».': [
    'No profile selected — open the Account tab.', 'Профіль не вибрано — відкрийте вкладку «Акаунт».'],

  // ---- Ely.by ----
  'Бесплатные аккаунты со своими скинами и плащами. Работают на серверах, которые их поддерживают.': [
    'Free accounts with their own skins and capes. They work on servers that support Ely.by.',
    'Безкоштовні акаунти з власними скінами та плащами. Працюють на серверах, які їх підтримують.'],
  'Почта или ник': ['Email or nickname', 'Пошта або нік'],
  'Пароль': ['Password', 'Пароль'],
  'Код двухфакторной защиты': ['Two-factor code', 'Код двофакторного захисту'],
  'Войти через Ely.by': ['Sign in with Ely.by', 'Увійти через Ely.by'],
  'Нет аккаунта?': ['No account yet?', 'Немає акаунта?'],
  'Зарегистрироваться на ely.by': ['Register at ely.by', 'Зареєструватися на ely.by'],
  'Введите почту и пароль': ['Enter your email and password', 'Введіть пошту та пароль'],
  'Введите код из приложения-аутентификатора и нажмите вход ещё раз.': [
    'Enter the code from your authenticator app and press sign in again.',
    'Введіть код з програми-автентифікатора та натисніть вхід ще раз.'],
  'вход…': ['signing in…', 'вхід…'],

  // ---- настройки ----
  'Память, Java и поведение лаунчера': [
    'Memory, Java and launcher behaviour', 'Пам’ять, Java та поведінка лаунчера'],
  'Оперативная память': ['Memory', 'Оперативна пам’ять'],
  'Сколько памяти выделить': ['How much memory to allocate', 'Скільки пам’яті виділити'],
  'Минимум (Xms), МБ': ['Minimum (Xms), MB', 'Мінімум (Xms), МБ'],
  'Путь к java.exe': ['Path to java.exe', 'Шлях до java.exe'],
  'пусто — подобрать автоматически': ['empty — detect automatically', 'порожньо — підібрати автоматично'],
  'выбирается автоматически': ['detected automatically', 'обирається автоматично'],
  'по умолчанию': ['default', 'за замовчуванням'],
  'Скачать Java 8': ['Download Java 8', 'Завантажити Java 8'],
  'Скачать Java 17': ['Download Java 17', 'Завантажити Java 17'],
  'Скачать Java 21': ['Download Java 21', 'Завантажити Java 21'],
  'Java выбрана': ['Java selected', 'Java обрано'],
  'поиск java…': ['looking for java…', 'пошук java…'],
  'java не найдена — скачайте кнопкой ниже': [
    'java not found — download it with the button below', 'java не знайдено — завантажте кнопкою нижче'],
  'Игра': ['Game', 'Гра'],
  'Ширина': ['Width', 'Ширина'],
  'Высота': ['Height', 'Висота'],
  'Полноэкранный режим': ['Fullscreen', 'Повноекранний режим'],
  'Сворачивать лаунчер при запуске игры': [
    'Minimise the launcher when the game starts', 'Згортати лаунчер під час запуску гри'],
  'JVM-аргументы': ['JVM arguments', 'JVM-аргументи'],
  'Статус в Discord': ['Discord status', 'Статус у Discord'],
  'Друзья будут видеть, что вы играете в Minecraft через Plus Launcher — версию, сборку и сколько времени уже играете.': [
    'Friends will see that you are playing Minecraft through Plus Launcher — the version, the instance and how long you have been playing.',
    'Друзі бачитимуть, що ви граєте в Minecraft через Plus Launcher — версію, збірку та скільки часу вже граєте.'],
  'Показывать статус в Discord': ['Show status in Discord', 'Показувати статус у Discord'],
  'Показывать название сборки': ['Show the instance name', 'Показувати назву збірки'],
  'подключено': ['connected', 'підключено'],
  'выключено': ['off', 'вимкнено'],
  'Discord не запущен': ['Discord is not running', 'Discord не запущено'],
  'Discord не запущен. Статус появится сам, когда вы его откроете.': [
    'Discord is not running. The status will appear once you open it.',
    'Discord не запущено. Статус з’явиться сам, коли ви його відкриєте.'],
  'Discord на связи — статус виден друзьям. Если его всё равно не видно, включите в Discord: Настройки → Игровая активность → «Отображать текущую активность».': [
    'Discord is connected — friends can see the status. If it still does not show, enable it in Discord: Settings → Activity Privacy → “Display current activity as a status message”.',
    'Discord на зв’язку — статус видно друзям. Якщо його все одно не видно, увімкніть у Discord: Налаштування → Ігрова активність → «Показувати поточну активність».'],
  'В сборке не указан Application ID Discord — он задаётся в app-config.js.': [
    'No Discord Application ID in this build — it is set in app-config.js.',
    'У збірці не вказано Application ID Discord — він задається в app-config.js.'],
  'Обновления лаунчера': ['Launcher updates', 'Оновлення лаунчера'],
  'Лаунчер смотрит последний релиз на GitHub и сообщает, когда выходит новая версия.': [
    'The launcher checks the latest GitHub release and tells you when a new version is out.',
    'Лаунчер дивиться останній реліз на GitHub і повідомляє, коли виходить нова версія.'],
  'Проверить сейчас': ['Check now', 'Перевірити зараз'],
  'Проверять обновления при запуске': ['Check for updates on start', 'Перевіряти оновлення під час запуску'],
  'Проверяю…': ['Checking…', 'Перевіряю…'],
  'проверяю…': ['checking…', 'перевіряю…'],
  'Разбирать вылеты игры через ИИ': ['Explain game crashes with AI', 'Розбирати вильоти гри через ШІ'],
  'Если игра закрылась с ошибкой, лаунчер отправляет её лог в DeepSeek и показывает, в чём причина. Имя пользователя Windows из лога вырезается.': [
    'If the game exits with an error, the launcher sends its log to DeepSeek and shows the cause. Your Windows username is stripped from the log.',
    'Якщо гра закрилася з помилкою, лаунчер надсилає її лог у DeepSeek і показує причину. Ім’я користувача Windows із лога вирізається.'],
  'Скачать и установить': ['Download and install', 'Завантажити та встановити'],
  'Установить при выходе': ['Install on exit', 'Встановити під час виходу'],
  'Установить и перезапустить': ['Install and restart', 'Встановити та перезапустити'],
  'Открыть страницу релиза': ['Open the release page', 'Відкрити сторінку релізу'],
  'Качаю обновление…': ['Downloading the update…', 'Завантажую оновлення…'],
  'Обновление загружено': ['Update downloaded', 'Оновлення завантажено'],
  'Описание релиза не заполнено.': ['The release notes are empty.', 'Опис релізу не заповнено.'],
  'Лаунчер закроется и поставит обновление. Игра, если запущена, продолжит работать.': [
    'The launcher will close and install the update. A running game keeps playing.',
    'Лаунчер закриється та встановить оновлення. Гра, якщо запущена, продовжить працювати.'],

  // ---- соединение ----
  'Соединение и зеркала': ['Connection and mirrors', 'З’єднання та дзеркала'],
  'Официальные серверы Mojang из России часто отвечают рывками, и установка версии зависает. Лаунчер умеет качать те же файлы с зеркала — VPN для этого не нужен. Все файлы игры проверяются по контрольной сумме Mojang, так что подменить их зеркало не может.': [
    'Mojang servers can be slow or unreachable in some countries, and installing a version stalls. The launcher can pull the very same files from a mirror — no VPN needed. Every game file is checked against the Mojang checksum, so a mirror cannot swap it.',
    'Офіційні сервери Mojang з деяких країн часто відповідають ривками, і встановлення версії зависає. Лаунчер вміє завантажувати ті самі файли з дзеркала — VPN для цього не потрібен. Усі файли гри перевіряються за контрольною сумою Mojang, тож підмінити їх дзеркало не може.'],
  'Автоматически': ['Automatic', 'Автоматично'],
  'Всегда зеркало': ['Always mirror', 'Завжди дзеркало'],
  'Только Mojang': ['Mojang only', 'Лише Mojang'],
  'Сначала пробуем Mojang, при сбое сразу переключаемся на зеркало. Подходит почти всем.': [
    'Tries Mojang first and switches to the mirror the moment it fails. Right for almost everyone.',
    'Спершу пробуємо Mojang, при збої одразу перемикаємось на дзеркало. Підходить майже всім.'],
  'Все файлы игры качаются с зеркала. Ставьте, если Mojang у вашего провайдера не открывается совсем.': [
    'All game files come from the mirror. Pick this if Mojang does not open at your provider at all.',
    'Усі файли гри завантажуються з дзеркала. Обирайте, якщо Mojang у вашого провайдера не відкривається зовсім.'],
  'Только официальные серверы Mojang. Если они недоступны, установка версии не пройдёт.': [
    'Official Mojang servers only. If they are unreachable, installing a version will fail.',
    'Лише офіційні сервери Mojang. Якщо вони недоступні, встановлення версії не пройде.'],
  'Проверить соединение': ['Check connection', 'Перевірити з’єднання'],
  'проверяю доступность серверов…': ['checking servers…', 'перевіряю доступність серверів…'],
  'не удалось выполнить проверку': ['the check could not be run', 'не вдалося виконати перевірку'],
  'не проверено': ['not checked', 'не перевірено'],
  'всё работает': ['all good', 'усе працює'],
  'работает через зеркало': ['working via mirror', 'працює через дзеркало'],
  'есть проблемы': ['problems found', 'є проблеми'],
  'ошибка': ['error', 'помилка'],
  'недоступен': ['unreachable', 'недоступний'],
  'нет ответа': ['no response', 'немає відповіді'],
  'нет связи': ['no connection', 'немає зв’язку'],
  'нужно для игры': ['required to play', 'потрібно для гри'],
  'нужно для лицензии': ['required for a licence', 'потрібно для ліцензії'],
  'дополнительно': ['optional', 'додатково'],
  'Режим загрузки сохранён': ['Download mode saved', 'Режим завантаження збережено'],

  // ---- папка лаунчера ----
  'Папка лаунчера': ['Launcher folder', 'Тека лаунчера'],
  'Здесь лежат версии, библиотеки, ресурсы, Java и папки версий с модами и мирами. Их можно держать на другом диске.': [
    'Versions, libraries, assets, Java and per-version folders with mods and worlds live here. You can keep them on another drive.',
    'Тут лежать версії, бібліотеки, ресурси, Java та теки версій з модами й світами. Їх можна тримати на іншому диску.'],
  'Где держать файлы игры?': ['Where to keep the game files?', 'Де тримати файли гри?'],
  'Новая папка лаунчера': ['New launcher folder', 'Нова тека лаунчера'],
  'Папка сохранена': ['Folder saved', 'Теку збережено'],
  'Папка изменена — лаунчер перезапускается': [
    'Folder changed — the launcher is restarting', 'Теку змінено — лаунчер перезапускається'],
  'Перезапуск лаунчера…': ['Restarting the launcher…', 'Перезапуск лаунчера…'],
  'В папке уже есть данные лаунчера': [
    'This folder already has launcher data', 'У теці вже є дані лаунчера'],
  'Использовать эти данные': ['Use that data', 'Використати ці дані'],
  'Начать с пустой папки': ['Start with an empty folder', 'Почати з порожньої теки'],
  'Начать с пустой папки?': ['Start with an empty folder?', 'Почати з порожньої теки?'],
  'Версии, моды и миры останутся в старой папке, лаунчер их больше не увидит. Список сборок и профили будут пустыми.': [
    'Versions, mods and worlds stay in the old folder and the launcher will no longer see them. The instance list and profiles will be empty.',
    'Версії, моди та світи залишаться у старій теці, лаунчер їх більше не побачить. Список збірок і профілі будуть порожніми.'],
  'Да, начать заново': ['Yes, start over', 'Так, почати спочатку'],
  'Выбрать другую папку': ['Pick another folder', 'Обрати іншу теку'],
  'Оставить по умолчанию': ['Keep the default', 'Залишити за замовчуванням'],
  'Запустить как есть': ['Run as is', 'Запустити як є'],

  // ---- консоль и вылеты ----
  'Вывод Minecraft и лаунчера': ['Minecraft and launcher output', 'Вивід Minecraft і лаунчера'],
  'Завершить игру': ['Kill the game', 'Завершити гру'],
  'Игра закрылась с ошибкой': ['The game exited with an error', 'Гра закрилася з помилкою'],
  'Открыть консоль': ['Open the console', 'Відкрити консоль'],
  'Разобрать заново': ['Explain again', 'Розібрати знову'],
  'Разбираю, что случилось…': ['Working out what happened…', 'Розбираю, що сталося…'],
  'неизвестная причина': ['unknown cause', 'невідома причина'],

  // ---- помощник ----
  'Чем помочь?': ['How can I help?', 'Чим допомогти?'],
  'Спросите про моды, версии, ошибки или настройки лаунчера.': [
    'Ask about mods, versions, errors or launcher settings.',
    'Запитайте про моди, версії, помилки чи налаштування лаунчера.'],
  'Напишите вопрос… (Enter — отправить, Shift+Enter — новая строка)': [
    'Type your question… (Enter to send, Shift+Enter for a new line)',
    'Напишіть питання… (Enter — надіслати, Shift+Enter — новий рядок)'],
  'Спросить': ['Ask', 'Запитати'],
  'Очистить переписку': ['Clear the chat', 'Очистити листування'],
  'Помощник — Plus Launcher': ['Assistant — Plus Launcher', 'Помічник — Plus Launcher'],
  'Разобрать последний вылет': ['Explain the last crash', 'Розібрати останній виліт'],
  'Игра вылетела — разбери мой последний запуск': [
    'The game crashed — explain my last run', 'Гра вилетіла — розбери мій останній запуск'],
  'Моды на оптимизацию': ['Performance mods', 'Моди на оптимізацію'],
  'Посоветуй моды на оптимизацию для моей сборки': [
    'Recommend performance mods for my instance', 'Порадь моди на оптимізацію для моєї збірки'],
  'Чем отличаются загрузчики': ['Loader differences', 'Чим відрізняються завантажувачі'],
  'Чем отличаются Fabric, Quilt, Forge и NeoForge?': [
    'What is the difference between Fabric, Quilt, Forge and NeoForge?',
    'Чим відрізняються Fabric, Quilt, Forge та NeoForge?'],
  'Сколько памяти выделить и какие аргументы JVM поставить?': [
    'How much memory should I allocate and which JVM arguments should I use?',
    'Скільки пам’яті виділити та які аргументи JVM поставити?'],
  'Не получилось ответить': ['Could not answer', 'Не вдалося відповісти'],
  'Нет сборки': ['No instance', 'Немає збірки'],
  'Нет сборки — создайте её во вкладке «Версии»': [
    'No instance — create one on the Versions tab', 'Немає збірки — створіть її у вкладці «Версії»'],
  'Моды не установлены.': ['No mods installed.', 'Моди не встановлено.'],
  'Сборок пока нет — их создают во вкладке «Версии».': [
    'No instances yet — you create them on the Versions tab.',
    'Збірок поки немає — їх створюють у вкладці «Версії».'],

  // ---- поддержка ----
  'Поддержка': ['Support', 'Підтримка'],
  'Что-то не работает или есть предложение — напишите, разберёмся. Если игра вылетела, приложите текст из вкладки «Консоль».': [
    'Something broken or an idea to share — write to us. If the game crashed, attach the text from the Console tab.',
    'Щось не працює або є пропозиція — напишіть, розберемось. Якщо гра вилетіла, додайте текст із вкладки «Консоль».'],
  'Написать в Telegram': ['Message on Telegram', 'Написати в Telegram'],
  'Написать в поддержку': ['Contact support', 'Написати в підтримку'],
  'Сайт лаунчера': ['Launcher website', 'Сайт лаунчера'],
  'Разбор скопирован — вставьте его в сообщение': [
    'The report is copied — paste it into your message',
    'Розбір скопійовано — вставте його у повідомлення'],

  // ---- иконка сборки, двойной клик, подбор Java ----
  'Иконка': ['Icon', 'Іконка'],
  'Выбрать': ['Choose', 'Обрати'],
  'Убрать': ['Remove', 'Прибрати'],
  'Иконка сборки обновлена': ['Instance icon updated', 'Іконку збірки оновлено'],
  'Картинка больше 4 МБ — возьмите поменьше': [
    'The image is over 4 MB — pick a smaller one', 'Зображення більше 4 МБ — візьміть менше'],
  'Такой формат картинки не поддерживается': [
    'That image format is not supported', 'Такий формат зображення не підтримується'],
  'Игра уже запущена': ['The game is already running', 'Гра вже запущена'],
  'Каждая версия живёт в своей папке со своими модами. Двойной клик по карточке запускает игру': [
    'Every version lives in its own folder with its own mods. Double-click a card to play',
    'Кожна версія живе у власній теці зі своїми модами. Подвійний клік по картці запускає гру'],
  'Лаунчер сам подбирает Java под каждую версию игры: старым версиям нужна Java 8, новым — 17 или 21. Если нужной нет, она скачается. Путь ниже используется только для версий, которым подходит именно эта Java.': [
    'The launcher picks Java for each game version by itself: old versions need Java 8, new ones need 17 or 21. A missing one gets downloaded. The path below is used only for versions that match that exact Java.',
    'Лаунчер сам підбирає Java під кожну версію гри: старим версіям потрібна Java 8, новим — 17 або 21. Якщо потрібної немає, вона завантажиться. Шлях нижче використовується лише для версій, яким підходить саме ця Java.'],
  'Нужна Java %s, её нет — скачиваю': [
    'Java %s is required and missing — downloading', 'Потрібна Java %s, її немає — завантажую'],

  // ---- модпаки ----
  'Установить сборку': ['Install modpack', 'Встановити збірку'],
  'Установить модпак': ['Install the modpack', 'Встановити модпак'],
  'Модпак ставится в новую сборку: лаунчер сам поставит нужную версию игры, загрузчик, все моды и настройки автора. Существующие сборки не изменятся.': [
    'A modpack goes into a new instance: the launcher installs the right game version, the loader, every mod and the author’s settings. Your existing instances stay untouched.',
    'Модпак встановлюється в нову збірку: лаунчер сам поставить потрібну версію гри, завантажувач, усі моди та налаштування автора. Наявні збірки не зміняться.'],
  'Появится {новая сборка} со своей версией игры, загрузчиком, модами и настройками автора.\n\nВаши существующие сборки не изменятся. Загрузка может занять несколько минут — модпаки весят сотни мегабайт.': [
    'A {new instance} will appear with its own game version, loader, mods and the author’s settings.\n\nYour existing instances stay untouched. The download can take several minutes — modpacks are hundreds of megabytes.',
    'З’явиться {нова збірка} зі своєю версією гри, завантажувачем, модами та налаштуваннями автора.\n\nВаші наявні збірки не зміняться. Завантаження може зайняти кілька хвилин — модпаки важать сотні мегабайт.'],
  'Модпак установлен: %s (%s из %s модов)': [
    'Modpack installed: %s (%s of %s mods)', 'Модпак встановлено: %s (%s з %s модів)'],
  'Версии загрузчика %s больше нет, поставлена %s': [
    'Loader version %s no longer exists, installed %s instead',
    'Версії завантажувача %s більше немає, встановлено %s'],
  '%s модов автор запретил скачивать вне сайта — доставьте их вручную': [
    'The author blocked %s mods from downloading outside their site — add them manually',
    'Автор заборонив завантажувати %s модів поза сайтом — додайте їх вручну'],
  'Не скачалось модов: %s': ['Mods that failed to download: %s', 'Не завантажилося модів: %s'],

  // ---- уборка места, копия сборки, фильтр модов ----
  'Освободить место': ['Free up space', 'Звільнити місце'],
  'Версии, которыми вы больше не пользуетесь, оставляют после себя библиотеки и ресурсы игры. Лаунчер найдёт их и покажет, сколько занимают.': [
    'Versions you no longer use leave behind libraries and game assets. The launcher finds them and shows how much they take.',
    'Версії, якими ви більше не користуєтесь, залишають по собі бібліотеки та ресурси гри. Лаунчер знайде їх і покаже, скільки вони займають.'],
  'считаю, что можно убрать…': ['working out what can go…', 'рахую, що можна прибрати…'],
  'не удалось посчитать': ['could not calculate', 'не вдалося порахувати'],
  'Удалить выбранное': ['Delete selected', 'Видалити вибране'],
  'Удалить выбранное?': ['Delete the selected items?', 'Видалити вибране?'],
  'ничего не выбрано': ['nothing selected', 'нічого не вибрано'],
  'Лишних файлов нет — всё, что скачано, используется сборками.': [
    'No leftovers — everything downloaded is in use by your instances.',
    'Зайвих файлів немає — усе завантажене використовується збірками.'],
  'Неиспользуемые версии игры': ['Unused game versions', 'Невикористовувані версії гри'],
  'Библиотеки от удалённых версий': ['Libraries from removed versions', 'Бібліотеки від видалених версій'],
  'Ресурсы игры от удалённых версий': ['Game assets from removed versions', 'Ресурси гри від видалених версій'],
  'Кэш загрузок': ['Download cache', 'Кеш завантажень'],
  'Установщики Forge и NeoForge, архивы модпаков. Скачаются заново, если понадобятся': [
    'Forge and NeoForge installers, modpack archives. They download again if needed',
    'Встановлювачі Forge і NeoForge, архіви модпаків. Завантажаться знову, якщо знадобляться'],
  'Можно освободить до %s. Файлы нужных сборок не трогаются.': [
    'Up to %s can be freed. Files your instances need are left alone.',
    'Можна звільнити до %s. Файли потрібних збірок не чіпаються.'],
  'выбрано %s': ['%s selected', 'вибрано %s'],
  'Освобождено %s': ['Freed %s', 'Звільнено %s'],
  'Дублировать сборку': ['Duplicate instance', 'Дублювати збірку'],
  'Дублировать': ['Duplicate', 'Дублювати'],
  'Скопировать с мирами': ['Copy with worlds', 'Скопіювати зі світами'],
  'Только моды и настройки': ['Mods and settings only', 'Лише моди та налаштування'],
  'Создана копия: %s': ['Copy created: %s', 'Створено копію: %s'],
  'Фильтр по названию': ['Filter by name', 'Фільтр за назвою'],
  'ничего не найдено': ['nothing found', 'нічого не знайдено'],
  '%s из %s': ['%s of %s', '%s з %s'],

  // ---- скачивание скинов ----
  'Скачать скин игрока': ['Download a player’s skin', 'Завантажити скін гравця'],
  'Введите ник — лаунчер возьмёт скин с Mojang, а если такого ника там нет, поищет на Ely.by.': [
    'Enter a nickname — the launcher takes the skin from Mojang, and if the name is not there, looks on Ely.by.',
    'Введіть нік — лаунчер візьме скін з Mojang, а якщо такого ніка там немає, пошукає на Ely.by.'],
  'Ник игрока': ['Player nickname', 'Нік гравця'],
  'Мой скин': ['My skin', 'Мій скін'],
  'Скин текущего профиля': ['Skin of the current profile', 'Скін поточного профілю'],
  'Введите ник игрока': ['Enter a player nickname', 'Введіть нік гравця'],
  'В нике есть недопустимые символы': [
    'The nickname contains characters that are not allowed', 'У ніку є неприпустимі символи'],
  'Сервис вернул не PNG': ['The service returned something that is not a PNG', 'Сервіс повернув не PNG'],
  'На аккаунте стоит стандартный скин — скачивать нечего': [
    'The account uses the default skin — nothing to download',
    'На акаунті стоїть стандартний скін — завантажувати нічого'],
  'Игрок «%s» не найден ни на Mojang, ни на Ely.by': [
    'Player “%s” was not found on Mojang or Ely.by', 'Гравця «%s» не знайдено ні на Mojang, ні на Ely.by'],
  '%s: скин %s, модель %s': ['%s: skin %s, model %s', '%s: скін %s, модель %s'],
  '. У игрока есть плащ, но плащи так не скачиваются.': [
    '. The player has a cape, but capes cannot be downloaded this way.',
    '. У гравця є плащ, але плащі так не завантажуються.'],

  // ---- резервные копии миров ----
  'Резервные копии миров': ['World backups', 'Резервні копії світів'],
  'Копия — это zip с папкой мира. При восстановлении текущий мир не стирается, а откладывается рядом.': [
    'A backup is a zip of the world folder. Restoring does not erase the current world — it is set aside next to it.',
    'Копія — це zip з текою світу. Під час відновлення поточний світ не стирається, а відкладається поруч.'],
  'Миры сборки': ['Worlds', 'Світи збірки'],
  'Готовые копии': ['Backups', 'Готові копії'],
  'миров пока нет': ['no worlds yet', 'світів поки немає'],
  'копий пока нет': ['no backups yet', 'копій поки немає'],
  'Папка копий': ['Backup folder', 'Тека копій'],
  'Сделать копию': ['Back up', 'Зробити копію'],
  'Восстановить': ['Restore', 'Відновити'],
  'Восстановить мир?': ['Restore the world?', 'Відновити світ?'],
  'Мир восстановлен': ['World restored', 'Світ відновлено'],
  'Копировать миры перед запуском игры': [
    'Back up worlds before starting the game', 'Копіювати світи перед запуском гри'],
  'Копии лежат в папке backups и переживают удаление сборки. Восстановить мир можно в настройках сборки.': [
    'Backups live in the backups folder and survive deleting the instance. Restore a world from the instance settings.',
    'Копії лежать у теці backups і переживають видалення збірки. Відновити світ можна в налаштуваннях збірки.'],
  'Сколько копий каждого мира хранить': [
    'How many backups to keep per world', 'Скільки копій кожного світу зберігати'],
  'Копия готова: %s': ['Backup ready: %s', 'Копія готова: %s'],
  'Удалить копию %s?': ['Delete backup %s?', 'Видалити копію %s?'],
  'Мир восстановлен, прежний сохранён как %s': [
    'World restored, the previous one kept as %s', 'Світ відновлено, попередній збережено як %s'],
  'Мир {%s} вернётся к состоянию на %s.\n\nТекущая версия мира не удалится — она останется рядом с пометкой «до-восстановления».': [
    'The world {%s} will go back to how it was on %s.\n\nThe current version will not be deleted — it stays next to it marked “before restore”.',
    'Світ {%s} повернеться до стану на %s.\n\nПоточна версія світу не видалиться — вона залишиться поруч із позначкою «до відновлення».'],

  // ---- обновления модов ----
  'Проверить обновления': ['Check for updates', 'Перевірити оновлення'],
  'Обновления модов': ['Mod updates', 'Оновлення модів'],
  'Показывать beta и alpha': ['Show beta and alpha', 'Показувати beta та alpha'],
  'Выбрать все': ['Select all', 'Вибрати всі'],
  'Обновить выбранные': ['Update selected', 'Оновити вибрані'],
  'проверяю моды…': ['checking mods…', 'перевіряю моди…'],
  'все моды свежие': ['every mod is up to date', 'усі моди свіжі'],
  'не удалось проверить обновления': ['could not check for updates', 'не вдалося перевірити оновлення'],
  'Ничего не выбрано': ['Nothing selected', 'Нічого не вибрано'],
  'выключен': ['disabled', 'вимкнено'],
  'Проверено модов: %s. Обновлений: %s.': [
    'Mods checked: %s. Updates: %s.', 'Перевірено модів: %s. Оновлень: %s.'],
  'Обновлено модов: %s': ['Mods updated: %s', 'Оновлено модів: %s'],

  // ---- настройки отдельной сборки ----
  'Настройки сборки': ['Instance settings', 'Налаштування збірки'],
  'Память и Java': ['Memory and Java', 'Пам’ять і Java'],
  'Тяжёлому модпаку нужно больше памяти, а старым версиям — Java 8. Здесь это задаётся для одной сборки, не трогая остальные.': [
    'A heavy modpack needs more memory, and old versions need Java 8. Set it for this instance only, without touching the others.',
    'Важкому модпаку потрібно більше пам’яті, а старим версіям — Java 8. Тут це задається для однієї збірки, не чіпаючи інші.'],
  'Как в лаунчере': ['Same as launcher', 'Як у лаунчері'],
  'как в лаунчере': ['same as launcher', 'як у лаунчері'],
  'Свои настройки': ['Custom', 'Власні налаштування'],
  'свои настройки': ['custom', 'власні налаштування'],
  'Максимум памяти': ['Memory limit', 'Максимум пам’яті'],
  'Путь к Java': ['Path to Java', 'Шлях до Java'],
  'пусто — как в лаунчере': ['empty — same as launcher', 'порожньо — як у лаунчері'],
  'Сохранить': ['Save', 'Зберегти'],
  'Настройки сборки сохранены': ['Instance settings saved', 'Налаштування збірки збережено'],

  // ---- язык и тема ----
  'Язык и оформление': ['Language and appearance', 'Мова та оформлення'],
  'Язык': ['Language', 'Мова'],
  'Тема': ['Theme', 'Тема'],
  'Тёмная': ['Dark', 'Темна'],
  'Светлая': ['Light', 'Світла'],
  'Как в системе': ['Match system', 'Як у системі'],
  'Язык интерфейса меняется сразу, перезапуск не нужен. Помощник отвечает на языке вопроса.': [
    'The interface language changes instantly, no restart needed. The assistant replies in the language you ask in.',
    'Мова інтерфейсу змінюється одразу, перезапуск не потрібен. Помічник відповідає мовою запитання.'],

  // ---- строки, которые собираются на ходу: %s — подставляемая часть ----
  '%s мин назад': ['%s min ago', '%s хв тому'],
  '%s ч назад': ['%s h ago', '%s год тому'],
  '%s дн назад': ['%s d ago', '%s дн тому'],
  '%s Б': ['%s B', '%s Б'],
  '%s КБ': ['%s KB', '%s КБ'],
  '%s МБ': ['%s MB', '%s МБ'],
  '%s ГБ': ['%s GB', '%s ГБ'],
  '%s ТБ': ['%s TB', '%s ТБ'],
  '%s мс': ['%s ms', '%s мс'],
  'через зеркало · %s мс': ['via mirror · %s ms', 'через дзеркало · %s мс'],
  'Устанавливаю %s': ['Installing %s', 'Встановлюю %s'],
  'Готово — папка %s': ['Done — folder %s', 'Готово — тека %s'],
  'папка: %s': ['folder: %s', 'тека: %s'],
  'Источник недоступен: %s': ['Source unavailable: %s', 'Джерело недоступне: %s'],
  'Вход выполнен: %s': ['Signed in: %s', 'Вхід виконано: %s'],
  'Java %s выбрана': ['Java %s selected', 'Java %s обрано'],
  'Java установлена: %s': ['Java installed: %s', 'Java встановлено: %s'],
  'Добавлено: %s': ['Added: %s', 'Додано: %s'],
  'Поставлен %s': ['Installed %s', 'Встановлено %s'],
  'Плащ %s включён': ['Cape %s enabled', 'Плащ %s увімкнено'],
  'Удалить %s?': ['Delete %s?', 'Видалити %s?'],
  'Удалить %s из библиотеки?': ['Remove %s from the library?', 'Видалити %s з бібліотеки?'],
  'Вернуть стандартный скин на аккаунте Mojang?': [
    'Restore the default skin on your Mojang account?', 'Повернути стандартний скін на акаунті Mojang?'],
  'Удалить сборку «%s»?\n\nПапка %s со всеми модами и мирами будет удалена.': [
    'Delete the instance “%s”?\n\nThe folder %s with all its mods and worlds will be removed.',
    'Видалити збірку «%s»?\n\nТеку %s з усіма модами та світами буде видалено.'],
  'Профиль %s — оффлайн. «Применить» положит скин в папку версии для CustomSkinLoader.': [
    'Profile %s is offline. “Apply skin” saves the PNG into the instance folder for CustomSkinLoader.',
    'Профіль %s — офлайн. «Застосувати скін» покладе скін у теку версії для CustomSkinLoader.'],
  'Профиль %s — лицензия. «Применить» загрузит скин на сервер Mojang.': [
    'Profile %s has a licence. “Apply skin” uploads it to the Mojang server.',
    'Профіль %s — ліцензія. «Застосувати скін» завантажить скін на сервер Mojang.'],
  'Игра закрылась с ошибкой (код %s)': [
    'The game exited with an error (code %s)', 'Гра закрилася з помилкою (код %s)'],
  'разбор по: %s': ['based on: %s', 'розбір за: %s'],
  'Игра завершилась с кодом %s': ['The game exited with code %s', 'Гра завершилася з кодом %s'],
  'Не удалось разобрать ошибку: %s.\n\nОткройте консоль — там полный вывод игры.': [
    'Could not explain the error: %s.\n\nOpen the console for the full game output.',
    'Не вдалося розібрати помилку: %s.\n\nВідкрийте консоль — там повний вивід гри.'],
  'Discord не принял подключение: %s': [
    'Discord refused the connection: %s', 'Discord не прийняв підключення: %s'],
  'Установлена последняя версия — v%s': [
    'You are on the latest version — v%s', 'Встановлено останню версію — v%s'],
  'Доступна версия %s (у вас %s)': ['Version %s is available (you have %s)', 'Доступна версія %s (у вас %s)'],
  'Вышла версия %s': ['Version %s is out', 'Вийшла версія %s'],
  'Обновление %s': ['Update %s', 'Оновлення %s'],
  'Версия %s загружена': ['Version %s downloaded', 'Версію %s завантажено'],
  'Версия %s установится при следующем закрытии лаунчера': [
    'Version %s will install the next time you close the launcher',
    'Версія %s встановиться під час наступного закриття лаунчера'],
  'Не вышло скачать автоматически — откройте страницу релиза: %s': [
    'Automatic download failed — open the release page: %s',
    'Не вдалося завантажити автоматично — відкрийте сторінку релізу: %s'],
  'свободно на диске: %s': ['free on disk: %s', 'вільно на диску: %s'],
  'Перенести %s туда': ['Move %s there', 'Перенести %s туди'],
  'Не хватает %s': ['%s is missing', 'Бракує %s'],
  'Установить %s и запустить': ['Install %s and play', 'Встановити %s і запустити'],
  'Папка версии': ['Instance folder', 'Тека версії'],
  ' — последняя': [' — latest', ' — остання'],

  // ---- ошибки из main-процесса: приходят в тостах, поэтому переводятся так же ----
  'нет связи с %s': ['no connection to %s', 'немає зв’язку з %s'],
  '%s не отвечает (таймаут)': ['%s is not responding (timeout)', '%s не відповідає (тайм-аут)'],
  'файл %s скачался повреждённым': ['file %s downloaded corrupted', 'файл %s завантажився пошкодженим'],
  'Нет версий для Minecraft %s': ['No versions for Minecraft %s', 'Немає версій для Minecraft %s'],
  'Игра уже запущена': ['The game is already running', 'Гра вже запущена'],
  'Сборка не найдена': ['Instance not found', 'Збірку не знайдено'],
  'Сначала закройте игру': ['Close the game first', 'Спершу закрийте гру'],
  'Сначала добавьте аккаунт во вкладке «Аккаунт»': [
    'Add an account on the Account tab first', 'Спершу додайте акаунт у вкладці «Акаунт»'],
  'Нет данных о последнем запуске игры': [
    'No data about the last game run', 'Немає даних про останній запуск гри'],
  'Сессия Microsoft истекла — войдите заново': [
    'Your Microsoft session expired — sign in again', 'Сесія Microsoft закінчилася — увійдіть знову'],
  'Сессия Ely.by истекла — войдите заново во вкладке «Аккаунт»': [
    'Your Ely.by session expired — sign in again on the Account tab',
    'Сесія Ely.by закінчилася — увійдіть знову у вкладці «Акаунт»'],
  'Вход отменён': ['Sign-in cancelled', 'Вхід скасовано'],
  'Время ожидания входа истекло': ['The sign-in window timed out', 'Час очікування входу минув'],
  'На этом аккаунте не куплена Minecraft: Java Edition.': [
    'This account has not purchased Minecraft: Java Edition.',
    'На цьому акаунті не придбано Minecraft: Java Edition.'],
  'У этого Microsoft-аккаунта нет профиля Xbox. Создайте его на xbox.com и повторите вход.': [
    'This Microsoft account has no Xbox profile. Create one at xbox.com and sign in again.',
    'У цього Microsoft-акаунта немає профілю Xbox. Створіть його на xbox.com і повторіть вхід.'],
  'Детский аккаунт: нужно добавить его в семью Microsoft.': [
    'Child account: it has to be added to a Microsoft family.',
    'Дитячий акаунт: його треба додати до сім’ї Microsoft.'],
  'Xbox Live недоступен в вашем регионе.': [
    'Xbox Live is not available in your region.', 'Xbox Live недоступний у вашому регіоні.'],
  'Неверный логин или пароль': ['Wrong login or password', 'Невірний логін або пароль'],
  'Введите логин и пароль Ely.by': ['Enter your Ely.by login and password', 'Введіть логін і пароль Ely.by'],
  'Нужен код двухфакторной защиты': ['A two-factor code is required', 'Потрібен код двофакторного захисту'],
  'Аккаунт заблокирован на Ely.by': ['The account is blocked on Ely.by', 'Акаунт заблоковано на Ely.by'],
  'Слишком много попыток входа — подождите пару минут': [
    'Too many sign-in attempts — wait a couple of minutes',
    'Забагато спроб входу — зачекайте кілька хвилин'],
  'Аккаунт не подтверждён — проверьте почту на сайте Ely.by': [
    'The account is not confirmed — check your email on the Ely.by site',
    'Акаунт не підтверджено — перевірте пошту на сайті Ely.by'],
  'На аккаунте Ely.by нет игрового профиля — создайте ник на сайте': [
    'This Ely.by account has no game profile — pick a nickname on the site',
    'На акаунті Ely.by немає ігрового профілю — створіть нік на сайті'],
  'Не удалось получить authlib-injector — проверьте соединение': [
    'Could not fetch authlib-injector — check your connection',
    'Не вдалося отримати authlib-injector — перевірте з’єднання'],
  'Не удалось проверить сессию Ely.by — нет связи с сервисом': [
    'Could not verify the Ely.by session — no connection to the service',
    'Не вдалося перевірити сесію Ely.by — немає зв’язку із сервісом'],
  'authlib-injector скачался повреждённым': [
    'authlib-injector downloaded corrupted', 'authlib-injector завантажився пошкодженим'],
  'Это не PNG-файл': ['That is not a PNG file', 'Це не PNG-файл'],
  'Загрузка на сервер доступна только для лицензии Microsoft': [
    'Uploading works only with a Microsoft licence',
    'Завантаження на сервер доступне лише для ліцензії Microsoft'],
  'Для скинов в оффлайне нужна сборка с загрузчиком (Fabric, Quilt, Forge или NeoForge)': [
    'Offline skins need an instance with a loader (Fabric, Quilt, Forge or NeoForge)',
    'Для скінів в офлайні потрібна збірка із завантажувачем (Fabric, Quilt, Forge або NeoForge)'],
  'Обновление не найдено': ['No update found', 'Оновлення не знайдено'],
  'Автообновление работает только в собранном лаунчере': [
    'Auto-update works only in a packaged launcher',
    'Автооновлення працює лише у зібраному лаунчері'],
  'Это та же самая папка': ['That is the same folder', 'Це та сама тека'],
  'Нельзя выбрать папку внутри текущей папки лаунчера': [
    'You cannot pick a folder inside the current launcher folder',
    'Не можна обрати теку всередині поточної теки лаунчера'],
  'Нельзя выбрать папку, внутри которой лежит текущая папка лаунчера': [
    'You cannot pick a folder that contains the current launcher folder',
    'Не можна обрати теку, всередині якої лежить поточна тека лаунчера'],
};

let lang = 'ru';

/*
 * Строки с подстановкой. В ключе %s значит «здесь что угодно»: имя мода, число, версия.
 * Так переводятся сообщения вида «Java 17 выбрана», собранные на ходу, —
 * и переписывать полсотни мест вызова не нужно.
 * Фигурные скобки не используем: в модалках {текст} означает жирный шрифт.
 */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERNS = Object.entries(DICT)
  .filter(([key]) => key.includes('%s'))
  // Сначала более конкретные: иначе «через зеркало · %s мс» проиграет общему «%s мс»
  // и половина строки останется непереведённой.
  .sort((a, b) => b[0].replace(/%s/g, '').length - a[0].replace(/%s/g, '').length)
  .map(([key, row]) => ({ re: new RegExp(`^${key.split('%s').map(escapeRe).join('([\\s\\S]+?)')}$`), row }));

/** Перевод одной строки. Нет в словаре — возвращаем как есть. */
function t(text, depth = 0) {
  if (lang === 'ru' || !text) return text;
  if (Object.hasOwn(DICT, text)) return DICT[text][I[lang]] || text;
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (!m) continue;
    let i = 1;
    return (p.row[I[lang]] || text).replace(/%s/g, () => {
      const part = m[i++] ?? '';
      // «Источник недоступен: нет связи с host» — вложенную ошибку тоже переводим.
      // Глубину ограничиваем, чтобы шаблон, поймавший сам себя, не зациклился.
      return depth < 2 && part !== text ? t(part, depth + 1) : part;
    });
  }
  return text;
}

// Внутри этих узлов текст приходит извне (лог игры, ответы помощника, названия
// модов из каталога) — его переводить нельзя.
const SKIP = 'console, #console, #chat, #mods-list, #crash-text, .row-desc, .row-title b, #installed-mods, script, style';

// data-q — готовые вопросы помощника: их тоже переводим, чтобы на английском
// нажатие кнопки отправляло английский вопрос, а не русский.
const ATTRS = ['placeholder', 'title', 'data-q'];

function translateEl(el) {
  if (el.nodeType !== 1 || !el.getAttribute) return;
  for (const attr of ATTRS) {
    const v = el.getAttribute(attr);
    if (!v) continue;
    // оригинал храним отдельно: иначе после второй смены языка переводить будет нечего
    const key = `i18n:${attr}`;
    const orig = el[key] || v;
    el[key] = orig;
    const tr = t(orig);
    if (tr !== v) el.setAttribute(attr, tr);
  }
}

/** Переводит все текстовые узлы внутри root */
function translateDom(root = document.body) {
  if (!root || root.nodeType === 3) { translateText(root); return; }
  if (root.nodeType !== 1) return;
  if (root.closest && root.closest(SKIP)) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node.nodeType === 1 ? node : node.parentElement;
      if (el && el.closest(SKIP)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  translateEl(root);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === 3) translateText(node);
    else translateEl(node);
    node = walker.nextNode();
  }
}

/** Переводит текстовый узел, сохраняя пробелы вокруг */
function translateText(node) {
  if (!node || node.nodeType !== 3) return;
  const raw = node.nodeValue;
  const key = raw.trim();
  if (key.length < 2) return;
  // запоминаем оригинал, иначе после первой смены языка переводить будет нечего
  const orig = node.__i18n || key;
  node.__i18n = orig;
  const tr = t(orig);
  if (tr === key) return;
  node.nodeValue = raw.replace(key, tr);
}

/** Меняет язык на лету и запоминает выбор для следующего запуска */
function setLang(next) {
  lang = LANGS.some((l) => l.id === next) ? next : 'ru';
  try { localStorage.setItem('lang', lang); } catch { /* приватный режим */ }
  document.documentElement.setAttribute('lang', lang);
  translateDom(document.body);
}

/**
 * Следим за появлением новых узлов: списки модов, версии, тосты и модалки
 * создаются на ходу, и их надо переводить сразу после вставки.
 */
function watch() {
  new MutationObserver((records) => {
    if (lang === 'ru') return;
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n.nodeType === 3) translateText(n);
        else translateDom(n);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

const getLang = () => lang;

window.i18n = { t, setLang, getLang, translateDom, watch, LANGS };

// Применяем сохранённый язык сразу, не дожидаясь чтения config.json:
// иначе интерфейс успевает показаться по-русски и потом дёргается.
(function boot() {
  let saved = null;
  try { saved = localStorage.getItem('lang'); } catch { /* приватный режим */ }
  if (saved && saved !== 'ru') setLang(saved);
  watch();
})();
