/*! Open Historia — deterministic engine UI localisation (display only). */
import { getStoredLanguage } from "../../runtime/i18n.js";

const RU = Object.freeze({
  Economy: "Экономика", Diplomacy: "Дипломатия", Statecraft: "Государство", Politics: "Политика",
  War: "Армия", Society: "Общество", Campaign: "Кампания", Advisor: "Советник", Stats: "Статистика",
  "Drag to resize": "Потяните, чтобы изменить ширину", "Clear chat": "Очистить переписку", "Close advisor": "Закрыть панель",
  "No messages yet. Ask your advisor something!": "Сообщений пока нет. Спросите что-нибудь у советника!",
  Error: "Ошибка", Thinking: "Размышляю", "Ask your advisor…  (Shift+Enter for a new line)": "Спросите советника…  (Shift+Enter — новая строка)",
  "No active game. Start one to see national statistics.": "Нет активной игры. Начните игру, чтобы увидеть статистику страны.",
  "Your country": "Ваша страна", Leader: "Лидер", "Regenerate this stat sheet": "Обновить статистику страны",
  "Compiling the stat sheet…": "Собираю статистику страны…", "Try again": "Повторить", "National stability": "Стабильность страны",
  "Strategic indices": "Стратегические показатели", Sovereignty: "Суверенитет", "Food autonomy": "Продовольственная независимость",
  "Energy autonomy": "Энергетическая независимость", "Economic independence": "Экономическая независимость",
  "Internal security": "Внутренняя безопасность", "International reputation": "Международная репутация",
  GDP: "ВВП", "GDP/capita": "ВВП на душу", Inflation: "Инфляция", Unemployment: "Безработица", "Public debt": "Государственный долг",
  "Budget balance": "Сальдо бюджета", Deficit: "Дефицит", Surplus: "Профицит", "GDP breakdown": "Структура ВВП",
  Agriculture: "Сельское хозяйство", Services: "Услуги", "Click any country on the map to inspect it.": "Нажмите на любую страну на карте, чтобы посмотреть её данные.",
  "The stat sheet failed.": "Не удалось собрать статистику страны.",
  "Foreign affairs": "Внешняя политика", Relations: "Отношения", Opinion: "Мнение", Trust: "Доверие", Threat: "Угроза",
  "Pending proposals": "Ожидающие предложения", None: "Нет", "Trade contract": "Торговый договор", "Private contact": "Частный контакт",
  Accept: "Принять", Reject: "Отклонить", Counter: "Встречное предложение", "Active agreements": "Действующие договоры",
  Trade: "Торговля", Terminate: "Расторгнуть", "New proposal": "Новое предложение", "Non-aggression": "Пакт о ненападении",
  "Defensive alliance": "Оборонительный союз", Guarantee: "Гарантия", "Military access": "Военный доступ", Queue: "Запланировать",
  "Queue resource-for-treasury trade": "Предложить обмен ресурсов на средства", "Last deliveries": "Последние поставки",
  delivered: "доставлено", breach: "нарушение", "Loading diplomacy…": "Загрузка дипломатии…",
  "Diplomacy is disabled in this scenario.": "Дипломатия отключена в этом сценарии.",
  "Acceptance queued.": "Принятие запланировано.", "Rejection queued.": "Отказ запланирован.",
  "Counterproposal queued.": "Встречное предложение запланировано.", "Termination queued.": "Расторжение запланировано.",
  "Resource amount": "Количество ресурса", "Treasury payment": "Платёж из казны", Months: "Месяцы",

  Finance: "Финансы", Treasury: "Казна", Debt: "Долг", Interest: "Процент", Defaults: "Дефолты",
  "Balanced budget": "Сбалансированный бюджет", "Industrial investment": "Инвестиции в промышленность",
  "Science investment": "Инвестиции в науку", "Security and military": "Безопасность и армия",
  administration: "управление", science: "наука", industry: "промышленность", security: "безопасность", military: "армия",
  "Queue finance policy": "Запланировать финансовую политику", "Issue bonds": "Выпустить облигации", Restructure: "Реструктурировать",
  "Capacity & projects": "Мощности и проекты", Administration: "Управление", Science: "Наука", Industry: "Промышленность",
  "No active projects": "Нет активных проектов", month: "месяц", Prioritise: "Повысить приоритет", Cancel: "Отменить",
  "Queue project": "Запустить проект", "Known facts": "Известные сведения", confidence: "достоверность", stale: "устарело", current: "актуально",
  "Loading statecraft…": "Загрузка государственного управления…", "Statecraft modules are disabled in this scenario.": "Государственное управление отключено в этом сценарии.",
  "Tax burden bp": "Налоговая нагрузка, б.п.", "Tax exemption bp": "Налоговые льготы, б.п.", "Budget stance": "Бюджетный курс",
  "Bond amount": "Сумма облигаций", "Project template": "Тип проекта", "Project region": "Регион проекта",
  "Intelligence target": "Цель разведки", "Monthly project funding": "Ежемесячное финансирование", "Project priority": "Приоритет проекта",
  "Finance policy queued for the next monthly boundary.": "Финансовая политика запланирована на следующий месяц.",
  "Bond issuance queued.": "Выпуск облигаций запланирован.", "Debt restructuring queued.": "Реструктуризация долга запланирована.",
  "Project queued for the next monthly boundary.": "Проект запланирован на следующий месяц.",
  "Higher project funding and priority queued.": "Повышение финансирования и приоритета запланировано.",
  "Project cancellation queued.": "Отмена проекта запланирована.",

  Heir: "Преемник", Legitimacy: "Легитимность", Stability: "Стабильность", Unrest: "Беспорядки",
  "Abdicate to heir": "Отречься в пользу преемника", "Factions and demands": "Фракции и требования", Support: "Поддержка", Power: "Влияние",
  tradition: "традиционализм", wants: "требует", Appointments: "Назначения", "Queue appointment": "Запланировать назначение",
  "Create fictional official": "Создать вымышленного чиновника", Fictional: "Вымышленный", Historical: "Исторический", "Create official": "Создать чиновника",
  "Key characters": "Ключевые фигуры", loyalty: "лояльность", ambition: "амбиции", unappointed: "без должности",
  "Loading politics…": "Загрузка политики…", "Internal politics is disabled in this scenario.": "Внутренняя политика отключена в этом сценарии.",
  "Political candidate": "Кандидат", "Political office": "Должность", "Runtime character name": "Имя персонажа", "Character origin": "Происхождение персонажа",
  "Fictional character faction": "Фракция персонажа", Name: "Имя", "Appointment queued.": "Назначение запланировано.",
  "Abdication queued.": "Отречение запланировано.", "Fictional official queued for confirmation.": "Создание чиновника отправлено на подтверждение.",
  concede: "уступить", repress: "подавить", refuse: "отказать", calm: "спокойствие", demanding: "выдвигает требования", ultimatum: "ультиматум",
  traditionalist: "традиционалисты", liberal: "либералы", socialist: "социалисты", fascist: "фашисты", communist: "коммунисты", conservative: "консерваторы",
  ruler: "глава государства", heir: "преемник", "head-of-government": "глава правительства", finance: "финансы", foreign: "иностранные дела",
  appointment: "назначение", hereditary: "наследование", election: "выборы", administrator: "администратор", diplomat: "дипломат", reformer: "реформатор",
  organizer: "организатор", defensive: "оборона", offensive: "наступление",

  "War ministry": "Военное министерство", "National reserves": "Национальные резервы", Recruitable: "Доступно для призыва", ceiling: "предел",
  "under arms": "под ружьём", casualties: "потери", "Equipment reserve": "Запас снаряжения", lost: "потеряно", Formations: "Соединения",
  troops: "военнослужащих", equipment: "снаряжения", morale: "боевой дух", At: "Расположение", posture: "приказ", ready: "готовность",
  Defend: "Обороняться", Advance: "Наступать", Demobilize: "Демобилизовать", "Mobilize reserves": "Мобилизовать резервы", "No commander": "Без командира",
  skill: "навык", "Queue mobilization": "Запланировать мобилизацию", "Wars and occupation": "Войны и оккупация",
  "Call to arms from": "Призыв к оружию от", "Defensive war": "Оборонительная война", obligation: "обязательство", "Join defenders": "Вступить на стороне защитников",
  Refuse: "Отказать", "No active war.": "Активных войн нет.", vs: "против", "actual control": "фактический контроль", "legal owner": "законный владелец",
  "Offer peace": "Предложить мир", "Declare war": "Объявить войну", Claim: "Претензия", Rivalry: "Соперничество", Defense: "Защита",
  "No recognized reason": "Нет признанного основания", "Queue declaration": "Запланировать объявление войны", "Peace offer from": "Мирное предложение от",
  "No territorial terms": "Без территориальных условий", reparations: "репарации", "Last combat": "Последний бой", Supply: "Снабжение", losses: "потери", seed: "модификатор",
  "Loading armed forces…": "Загрузка вооружённых сил…", "Armed forces are disabled in this scenario.": "Вооружённые силы отключены в этом сценарии.",
  "Mobilization region": "Регион мобилизации", "Reserve commander": "Командир резерва", "Mobilized manpower": "Мобилизуемые люди",
  "Mobilized equipment": "Выделяемое снаряжение", "War defender": "Противник", "War reason": "Основание войны", "Peace reparations": "Репарации",
  active: "активно", mobilizing: "мобилизуется", defend: "оборона", advance: "наступление", reserve: "резерв",
  claim: "претензия", rivalry: "соперничество", guarantee: "гарантия", defense: "защита", none: "нет",

  "Society & capabilities": "Общество и возможности", "National effects": "Общенациональные эффекты", "Culture mismatch": "Культурное несоответствие",
  "Religion mismatch": "Религиозное несоответствие", Tax: "Налоги", Recruitment: "Призыв", "Unrest pressure": "Давление беспорядков",
  Culture: "Культура", Religion: "Религия", official: "государственная", accepted: "признана", unaccepted: "не признана",
  tolerance: "терпимость", privilege: "привилегии", integration: "интеграция", coercion: "принуждение", "Queue policy": "Запланировать политику",
  "Present identities": "Представленные группы", Revoke: "Отменить признание", "Capabilities & research": "Возможности и исследования",
  unlocked: "открыто", locked: "закрыто", prerequisites: "требования", unavailable: "недоступно", "Last month causes": "Причины за прошлый месяц",
  culture: "культура", religion: "религия", "Loading society…": "Загрузка общества…",
  "Capabilities and identity are disabled in this scenario.": "Возможности и идентичность отключены в этом сценарии.",
  "culture policy": "Культурная политика", "religion policy": "Религиозная политика", Acceptance: "Признание", Revocation: "Отмена признания",

  "Soft horizon": "Горизонт кампании", "Reached — play may continue.": "Горизонт достигнут — игру можно продолжать.", "Current month": "Текущий месяц",
  "Interim assessments are available.": "Доступна промежуточная оценка.", "Assess legacy": "Оценить наследие", "Durable directions": "Долгосрочные цели",
  progress: "прогресс", "Adopt direction": "Принять цель", Crises: "Кризисы", "No recorded crisis involving this country.": "Кризисов с участием страны нет.",
  positions: "позиции", "Latest legacy": "Последняя оценка наследия", "Loading campaign…": "Загрузка кампании…",
  "Campaign goals are disabled in this scenario.": "Цели кампании отключены в этом сценарии.", candidate: "доступно", completed: "завершено", failed: "провалено",
  stabilize: "стабилизация", escalate: "эскалация", mediate: "посредничество", withdraw: "выход", resolved: "завершён",

  coal: "уголь", food: "продовольствие", goods: "товары", iron: "железо", oil: "нефть", wood: "древесина",
  "non-aggression": "пакт о ненападении", "defensive-alliance": "оборонительный союз", "military-access": "военный доступ",
  "one-off": "разово", monthly: "ежемесячно", medium: "средняя", high: "высокая", low: "низкая",

  "Administrative coordination": "Административная координация", "Administrative reform": "Административная реформа",
  "Build strategic readiness": "Повысить стратегическую готовность", "Control Austria": "Установить контроль над Австрией",
  "Expand staff planning": "Расширить штабное планирование", "General staff planning": "Планирование генерального штаба",
  "Industrial planning": "Промышленное планирование", "Intelligence assessment": "Разведывательная оценка",
  "Maintain constitutional stability": "Сохранить конституционную стабильность", "Maintain the National Government": "Сохранить Национальное правительство",
  "Preserve Austrian sovereignty": "Сохранить суверенитет Австрии", "Preserve regime stability": "Сохранить устойчивость режима",
  "Regional infrastructure": "Региональная инфраструктура", "Secure Austrian alignment": "Добиться ориентации Австрии",
  "Secure British security support": "Заручиться поддержкой безопасности Великобритании", "Secure British strategic coordination": "Обеспечить стратегическую координацию с Великобританией",
  "Secure French strategic coordination": "Обеспечить стратегическую координацию с Францией", "Secure Italian understanding": "Добиться взаимопонимания с Италией",
  "Stabilize parliamentary government": "Стабилизировать парламентское правительство", "Staff mobilization": "Штабная мобилизация",
  "Staff planning research": "Исследование штабного планирования", "State secularism": "Государственный секуляризм",
  "Austria home theatre": "Австрийская армия метрополии", "Czechoslovakia home theatre": "Чехословацкая армия метрополии",
  "France home theatre": "Французская армия метрополии", "Germany home theatre": "Германская армия метрополии",
  "Italy home theatre": "Итальянская армия метрополии", "Poland home theatre": "Польская армия метрополии",
  "United Kingdom home theatre": "Британская армия метрополии",

  "Vaterländische Front": "Отечественный фронт", "Institutional opposition": "Институциональная оппозиция",
  "Social and labour opposition": "Социальная и рабочая оппозиция", "Hradní koalice": "Градская коалиция",
  "Alliance démocratique": "Демократический альянс", "National Government": "Национальное правительство",
  "Democratic Party — New Deal coalition": "Демократическая партия — коалиция Нового курса",
  "Nationalsozialistische Deutsche Arbeiterpartei": "Национал-социалистическая немецкая рабочая партия",
  "Partito Nazionale Fascista": "Национальная фашистская партия", "Krąg prezydencki": "Президентский круг",
  "Obóz narodowy": "Национальный лагерь", "Obóz sanacyjny": "Санационный лагерь", "Polska Partia Socjalistyczna": "Польская социалистическая партия",
  "Regierungskommission des Saargebietes": "Правительственная комиссия Саарской области", "Senat der Freien Stadt Danzig": "Сенат Вольного города Данцига",

  American: "американцы", Austrian: "австрийцы", Belarusian: "белорусы", British: "британцы", Corsican: "корсиканцы", Czech: "чехи",
  French: "французы", German: "немцы", Irish: "ирландцы", Italian: "итальянцы", Jewish: "евреи", Polish: "поляки", Rusyn: "русины",
  Sardinian: "сардинцы", Scottish: "шотландцы", Sicilian: "сицилийцы", Slovak: "словаки", Soviet: "советские народы", Ukrainian: "украинцы", Welsh: "валлийцы",
  Catholic: "католицизм", Christian: "христианство",

  "Adolf Hitler": "Адольф Гитлер", "Albert Lebrun": "Альбер Лебрен", "Alfred Jansa": "Альфред Янса", "Arthur Greiser": "Артур Грейзер",
  "Benito Mussolini": "Бенито Муссолини", "Cyril Deverell": "Сирил Деверелл", "Edvard Beneš": "Эдвард Бенеш",
  "Edward Rydz-Śmigły": "Эдвард Рыдз-Смиглы", "Ernst Rüdiger Starhemberg": "Эрнст Рюдигер Штаремберг", "Franklin D. Roosevelt": "Франклин Делано Рузвельт",
  "Geoffrey Knox": "Джеффри Нокс", "George V": "Георг V", "Hermann Göring": "Герман Геринг", "Hermann Rauschning": "Герман Раушнинг",
  "Ignacy Mościcki": "Игнаций Мосцицкий", "Italo Balbo": "Итало Бальбо", "Jan Malypetr": "Ян Малипетр", "Johannes Hoffmann": "Йоханнес Хоффман",
  "John Nance Garner": "Джон Нэнс Гарнер", "Joseph Stalin": "Иосиф Сталин", "Józef Piłsudski": "Юзеф Пилсудский", "Kurt Schuschnigg": "Курт Шушниг",
  "Leon Kozłowski": "Леон Козловский", "Ludvík Krejčí": "Людвик Крейчи", "Maurice Gamelin": "Морис Гамелен",
  "Mieczysław Niedziałkowski": "Мечислав Недзялковский", "Mikhail Kalinin": "Михаил Калинин", "Pierre Laval": "Пьер Лаваль",
  "Pierre-Étienne Flandin": "Пьер-Этьен Фланден", "Pietro Badoglio": "Пьетро Бадольо", "Ramsay MacDonald": "Рамсей Макдональд",
  "Roman Dmowski": "Роман Дмовский", "Stanley Baldwin": "Стэнли Болдуин", "Tomáš Garrigue Masaryk": "Томаш Гарриг Масарик",
  "Vittorio Emanuele III": "Виктор Эммануил III", "Vyacheslav Molotov": "Вячеслав Молотов", "Werner von Fritsch": "Вернер фон Фрич",
  "Wilhelm Miklas": "Вильгельм Миклас", Vienna: "Вена", Prague: "Прага", Paris: "Париж", Berlin: "Берлин", Rome: "Рим", Warsaw: "Варшава", London: "Лондон",
  Europe: "Европа", Republic: "Республика", Monarchy: "Монархия", Dictatorship: "Диктатура",
  Austria: "Австрия", Czechoslovakia: "Чехословакия", France: "Франция", Germany: "Германия", Italy: "Италия", Poland: "Польша",
  Saargebiet: "Саарская область", "Freie Stadt Danzig": "Вольный город Данциг", "Soviet Union": "Советский Союз",
  "United Kingdom": "Великобритания", "United States": "Соединённые Штаты",
});

const labourRepresentative = /^(.*) era labour representative$/;
const publicInstitutions = /^(.*) public institutions and declared policy at the scenario snapshot\.$/;

export const engineLocale = () => getStoredLanguage();

export const engineText = (value, locale = engineLocale()) => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (locale !== "ru") return text;
  const representative = labourRepresentative.exec(text);
  if (representative) return `Представитель рабочих кругов эпохи: ${RU[representative[1]] ?? representative[1]}`;
  const institutions = publicInstitutions.exec(text);
  if (institutions) return `Государственные институты и официальная политика страны «${RU[institutions[1]] ?? institutions[1]}» на дату начала сценария.`;
  return RU[text] ?? text;
};

export const engineName = (entity, locale = engineLocale(), fallback = "") => {
  const names = entity?.displayName;
  if (!names || typeof names !== "object") return engineText(fallback, locale);
  const preferred = names[locale] ?? names.en ?? fallback;
  if (locale !== "ru") return preferred;
  if (typeof preferred === "string" && /[А-Яа-яЁё]/.test(preferred)) return preferred;
  return engineText(names.en ?? preferred ?? fallback, locale);
};

export const engineLocalized = (value, locale = engineLocale(), fallback = "") => {
  if (!value || typeof value !== "object") return engineText(value ?? fallback, locale);
  const preferred = value[locale] ?? value.en ?? fallback;
  if (locale === "ru" && typeof preferred === "string" && !/[А-Яа-яЁё]/.test(preferred)) {
    return engineText(value.en ?? preferred, locale);
  }
  return preferred;
};
