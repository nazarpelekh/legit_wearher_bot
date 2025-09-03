// Завантаження змінних оточення з .env файлу
require("dotenv").config();

const { Telegraf } = require("telegraf");

const { showMainSettings } = require("./handlers/settingsHandlers");
const { handleSettingsCallback } = require("./handlers/callbackHandlers");

// Імпорт модулів
const EnhancedNOAAService = require("./services/enhancedNoaaService");
const GeoService = require("./services/geoService");
const {
    getMainKeyboard,
    showCurrentConditions,
    handleForecast,
    handleAurora,
    handleAlerts,
    handleApiStatus,
} = require("./handlers/enhancedCommandHandlers");

// Конфігурація
const BOT_TOKEN = process.env.BOT_TOKEN;
const GEOCODING_API_KEY = process.env.GEOCODING_API_KEY || "";

// Створення бота
const bot = new Telegraf(BOT_TOKEN);

// Зберігання локацій користувачів (в продакшні краще використати базу даних)
const userLocations = new Map();
const userSettings = new Map();

// Налаштування сповіщень за замовчуванням
const defaultSettings = {
    notifications: false,
    kpThreshold: 5.0,
    auroraNotifications: true,
    dailyForecast: false,
    timezone: "Europe/Kiev",
};

// Логування
const log = (message) => {
    console.log(`[${new Date().toISOString()}] ${message}`);
};

// Команди бота
bot.start(async (ctx) => {
    const userName = ctx.from.first_name || "друже";
    const keyboard = getMainKeyboard();

    const welcomeMessage = `🌌 Вітаю, ${userName}!

Це Legit Weather Bot для моніторингу космічної погоди на основі даних NOAA Space Weather Prediction Center та GFZ Potsdam.

🔹 <b>Можливості бота:</b>
• Актуальні дані з двох джерел одночасно
• Автоматичний вибір кращого значення Kp
• Персоналізовані дані за локацією
• Сповіщення про космічну погоду
• Резервування API для надійності

📍 <b>Почніть з відправки локації</b> для отримання регіональних даних, або скористайтеся командами:

/current - поточні умови
/forecast - прогноз на 3 дні  
/alerts - активні попередження
/settings - налаштування сповіщень
/help - детальна довідка

🛰️ Дані з NOAA SWPC (основне) + GFZ Potsdam (резерв).`;

    await ctx.reply(welcomeMessage, { ...keyboard, parse_mode: "HTML" });
});

bot.help(async (ctx) => {
    const helpMessage = `📖 <b>Довідка Legit Weather Bot</b>

<b>🔧 Команди:</b>
/start - почати роботу
/current - поточні умови космічної погоди
/forecast - прогноз на 3 дні
/alerts - попередження та оповіщення
/settings - налаштування уведомлень
/help - ця довідка

<b>📊 Індекси космічної погоди:</b>

🔸 <b>Kp-індекс (0-9):</b>
• 0-2: 🟢 Спокійно
• 3-4: 🟡 Невелика активність  
• 5-6: 🟠 Помірна геомагнітна буря
• 7-8: 🔴 Сильна геомагнітна буря
• 9: 🚨 Екстремальна буря

<b>🌍 Вплив на життя:</b>
• Порушення GPS-навігації
• Проблеми з радіозв'язком
• Збої в роботі супутників
• Полярні сяйва на нижчих широтах
• Вплив на електромережі

<b>📡 Джерела даних:</b>
• NOAA Space Weather Prediction Center (основне)
• GFZ Potsdam (німецька геофізична служба)
• Правило: використовується більше значення Kp
• Супутники GOES 16/18
• Глобальна мережа магнетометрів

Дані оновлюються кожні 1-3 хвилини!`;

    await ctx.reply(helpMessage, { parse_mode: "HTML" });
});

// Обробка локації
bot.on("location", async (ctx) => {
    const { latitude, longitude } = ctx.message.location;
    const userId = ctx.from.id;

    log(
        `Отримано локацію від користувача ${userId}: ${latitude}, ${longitude}`
    );

    userLocations.set(userId, {
        latitude,
        longitude,
        timestamp: new Date(),
    });

    log(`Локацію збережено. Всього локацій: ${userLocations.size}`);

    try {
        const locationName = await GeoService.getLocationName(
            latitude,
            longitude,
            GEOCODING_API_KEY
        );
        const keyboard = getMainKeyboard();

        await ctx.reply(
            `✅ <b>Локація збережена!</b>\n` +
                `📍 ${locationName}\n` +
                `🌐 ${latitude.toFixed(4)}°, ${longitude.toFixed(4)}°\n\n` +
                `Тепер ви отримуватимете персоналізовані дані космічної погоди з NOAA та GFZ Potsdam для вашого регіону.\n\n` +
                `🌌 <b>Спробуйте "Полярні сяйва"</b> для персонального прогнозу!`,
            { ...keyboard, parse_mode: "HTML" }
        );
    } catch (error) {
        log(`Помилка обробки локації: ${error.message}`);
        await ctx.reply("❌ Помилка обробки локації. Спробуйте ще раз.");
    }
});

// Обробники текстових повідомлень
bot.hears("📊 Поточні дані", (ctx) =>
    showCurrentConditions(ctx, userLocations, GEOCODING_API_KEY)
);
bot.command("current", (ctx) =>
    showCurrentConditions(ctx, userLocations, GEOCODING_API_KEY)
);

bot.hears("🔮 Прогноз", (ctx) => handleForecast(ctx, userLocations));
bot.command("forecast", (ctx) => handleForecast(ctx, userLocations));

bot.hears("🌌 Полярні сяйва", (ctx) =>
    handleAurora(ctx, userLocations, GEOCODING_API_KEY)
);
bot.command("aurora", (ctx) =>
    handleAurora(ctx, userLocations, GEOCODING_API_KEY)
);

bot.hears("⚠️ Попередження", handleAlerts);
bot.command("alerts", handleAlerts);

// Розширені обробники callback_query
bot.on("callback_query", async (ctx) => {
    const action = ctx.callbackQuery.data;

    // Спочатку пробуємо обробити налаштування
    const settingsHandled = await handleSettingsCallback(
        ctx,
        action,
        userSettings,
        userLocations,
        GEOCODING_API_KEY
    );

    if (settingsHandled) {
        return; // Якщо оброблено в налаштуваннях, виходимо
    }

    // Решта callback обробників залишаються як є
    switch (action) {
        case "update_current":
            await ctx.answerCbQuery("🔄 Оновлюю дані з обох API...");
            await showCurrentConditions(ctx, userLocations, GEOCODING_API_KEY);
            break;

        case "show_forecast":
            await ctx.answerCbQuery("🔮 Завантажую прогноз...");
            await handleForecast(ctx, userLocations);
            break;

        case "show_alerts":
            await ctx.answerCbQuery("⚠️ Перевіряю попередження...");
            await handleAlerts(ctx);
            break;

        case "show_aurora":
            await ctx.answerCbQuery();
            await handleAurora(ctx, userLocations, GEOCODING_API_KEY);
            break;

        case "update_aurora":
            await ctx.answerCbQuery("🔄 Оновлюю прогноз полярних сяйв...");
            await handleAurora(ctx, userLocations, GEOCODING_API_KEY);
            break;

        case "update_forecast":
            await ctx.answerCbQuery("🔄 Оновлюю прогноз...");
            await handleForecast(ctx, userLocations);
            break;

        case "api_status":
            await handleApiStatus(ctx);
            break;

        case "show_chart":
            await ctx.answerCbQuery(
                "📈 Функція графіків буде додана в наступній версії!"
            );
            break;

        case "aurora_forecast_3day":
            await ctx.answerCbQuery(
                "📈 3-денний прогноз полярних сяйв буде додано в наступній версії!"
            );
            break;

        default:
            await ctx.answerCbQuery("🔄 Функція в розробці...");
            break;
    }
});

// Налаштування
bot.hears("⚙️ Налаштування", (ctx) => showMainSettings(ctx, userSettings));
bot.command("settings", (ctx) => showMainSettings(ctx, userSettings));

// Обробка помилок
bot.catch((err, ctx) => {
    log(`Помилка бота для ${ctx.updateType}: ${err.message}`);
    ctx.reply(
        "❌ Сталася технічна помилка в Legit Weather Bot.\n\n" +
            "🔄 Спробуйте пізніше або використайте /current для поточних даних.\n" +
            "🛰️ Статус API: /settings → 'Статус API'"
    );
});

// Запуск бота
async function startBot() {
    try {
        if (!BOT_TOKEN || BOT_TOKEN.trim() === "") {
            console.error("❌ Помилка: Токен бота не знайдено!");
            console.log("1. Перевірте файл .env");
            console.log("2. Переконайтеся, що BOT_TOKEN встановлено");
            process.exit(1);
        }

        log(
            "🚀 Запуск Legit Weather Bot з подвійним API (NOAA + GFZ Potsdam)..."
        );

        // Встановлюємо команди бота
        await bot.telegram.setMyCommands([
            { command: "start", description: "Почати роботу з ботом" },
            {
                command: "current",
                description: "Поточні умови (NOAA + GFZ Potsdam)",
            },
            {
                command: "forecast",
                description: "Прогноз на 3 дні з резервуванням",
            },
            {
                command: "aurora",
                description: "Прогноз полярних сяйв для вашої локації",
            },
            { command: "alerts", description: "Активні попередження" },
            { command: "settings", description: "Налаштування та статус API" },
            { command: "help", description: "Довідка та інструкції" },
        ]);

        // Тестуємо API при запуску
        log("🔍 Тестування API при запуску...");
        const apiStatus = await EnhancedNOAAService.getApiStatus();
        log(`NOAA доступний: ${apiStatus.noaa.available}`);
        log(`GFZ Potsdam доступний: ${apiStatus.gfz.available}`);

        if (!apiStatus.noaa.available && !apiStatus.gfz.available) {
            log("⚠️ УВАГА: Всі API недоступні при запуску!");
        } else if (apiStatus.noaa.available && apiStatus.gfz.available) {
            log("✅ Обидва API працюють нормально!");
        } else {
            log("🟡 Один з API недоступний, але бот може працювати");
        }

        // Запускаємо бота
        await bot.launch();

        log(
            "✅ Legit Weather Bot успішно запущений з подвійним API (NOAA + GFZ)!"
        );
        log(`🤖 Bot username: @${bot.botInfo.username}`);

        // Graceful shutdown
        process.once("SIGINT", () => bot.stop("SIGINT"));
        process.once("SIGTERM", () => bot.stop("SIGTERM"));
    } catch (error) {
        log(`❌ Помилка запуску бота: ${error.message}`);
        process.exit(1);
    }
}

// Запуск
if (require.main === module) {
    startBot();
}

module.exports = { bot, startBot };
