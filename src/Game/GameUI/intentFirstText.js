const RU = Object.freeze({
  Briefing: "Сводка", Orders: "Решения", Diplomacy: "Дипломатия", Country: "Страна", Situations: "Ситуации", Details: "Подробности",
  "Advance three months": "Продолжить на три месяца", "Time unavailable": "Время недоступно", "Strategic decision required": "Нужно стратегическое решение",
  Retry: "Повторить", "Continue without this decision": "Продолжить без этого решения", "What changed": "Что изменилось",
  "No material changes since the previous decision.": "С прошлого решения существенных изменений нет.",
  "Territorial transition": "Территориальный переход", Population: "Население", "Tax base": "Налоговая база", "Productive capacity": "Производственная мощность",
  "Recruitment access": "Доступ к набору", "Formation exceptions": "Исключения по соединениям",
  "Express intent, not parameters": "Выражайте намерение, а не параметры", "One intention per line. Claims about the past will be checked separately.": "Одно намерение в строке. Утверждения о прошлом проверяются отдельно.",
  "Interpret intention": "Проверить намерение", "Interpret intentions": "Проверить намерения", "Checking against the current world…": "Сверяем с текущим миром…",
  "Confirm grounded actions": "Подтвердить обоснованные действия", Revise: "Исправить", "Canonical commitments": "Канонические обязательства",
  Conversations: "Переговоры", "No active commitments.": "Нет действующих обязательств.", "No current conversations.": "Нет текущих переговоров.",
  "Response required": "Нужен ответ", "Awaiting response": "Ожидается ответ", "Compact grounded condition": "Краткое состояние по данным движка",
  "Needs attention": "Требует внимания", "Nothing currently requires intervention.": "Сейчас вмешательство не требуется.",
  "Respond with an intention": "Ответить намерением", "Secondary audit and domain views": "Вторичные журналы и данные",
  "Long-running processes": "Долгие процессы", "No active processes.": "Нет активных процессов.", "Domain detail": "Предметные сведения",
  Pace: "Темп", Feasibility: "Осуществимость", "Main inputs": "Главные входы", Spending: "Затраты", Progress: "Прогресс", Blockers: "Препятствия",
  Accelerators: "Ускорители", Support: "Поддержка", Opposition: "Противодействие", "Last semantic decision": "Последнее смысловое решение", "Next checkpoint": "Следующая проверка", "Why?": "Почему?",
});

export const intentText = (locale, text) => locale === "ru" ? (RU[text] ?? text) : text;
