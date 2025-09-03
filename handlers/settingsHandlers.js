const { Markup } = require("telegraf");
const FormatUtils = require("../utils/formatUtils");

// Логування
const log = (message) => {
    console.log(`[${new Date().toISOString()}] ${message}`);
};

// Налаштування за замовчуванням
const defaultSettings = {
    notifications: false,
    kpThreshold: 5.0,
    auroraNotifications: true,
    dailyForecast: false,
    timezone: "Europe/Kiev",
};

// Безпечне редагування повідомлень
async function safeEditMessage(ctx, text, options = {}) {
    try {
        await ctx.editMessageText(text, options);
    } catch (error) {
        if (error.description?.includes("message is not modified")) {
            log("Повідомлення вже актуальне, пропускаємо оновлення");
            return true;
        } else {
            log(`Помилка редагування повідомлення: ${error.message}`);
            try {
                await ctx.reply(text, options);
                return true;
            } catch (sendError) {
                log(
                    `Помилка надсилання нового повідомлення: ${sendError.message}`
                );
                return false;
            }
        }
    }
    return true;
}

// Головне меню налаштувань
async function showMainSettings(ctx, userSettings) {
    const userId = ctx.from.id;
    const settings = userSettings.get(userId) || defaultSettings;

    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback(
                "🔔 Налаштувати сповіщення",
                "setup_notifications"
            ),
        ],
        [Markup.button.callback("🌌 Полярні сяйва", "setup_aurora")],
        [Markup.button.callback("📊 Щоденний прогноз", "setup_daily")],
        [Markup.button.callback("🔧 Скинути налаштування", "reset_settings")],
    ]);

    const statusEmoji = settings.notifications ? "🟢" : "🔴";
    const auroraEmoji = settings.auroraNotifications ? "🟢" : "🔴";
    const dailyEmoji = settings.dailyForecast ? "🟢" : "🔴";

    await ctx.reply(
        `⚙️ <b>Налаштування Legit Weather Bot</b>\n\n` +
            `<b>🔸 Поточні налаштування:</b>\n` +
            `${statusEmoji} Сповіщення: ${
                settings.notifications ? "Увімкнено" : "Вимкнено"
            }\n` +
            `📈 Поріг Kp: ${settings.kpThreshold}\n` +
            `${auroraEmoji} Полярні сяйва: ${
                settings.auroraNotifications ? "Увімкнено" : "Вимкнено"
            }\n` +
            `${dailyEmoji} Щоденний прогноз: ${
                settings.dailyForecast ? "Увімкнено" : "Вимкнено"
            }\n\n` +
            `<b>🔸 Що означає поріг Kp?</b>\n` +
            `• 3.0 - часті сповіщення (невелика активність)\n` +
            `• 5.0 - помірні сповіщення (геомагнітні бурі)\n` +
            `• 7.0 - рідкісні сповіщення (сильні бурі)\n\n` +
            `Оберіть, що хочете налаштувати:`,
        {
            ...keyboard,
            parse_mode: "HTML",
        }
    );
}

// Налаштування порогу Kp
async function showKpThresholdSettings(ctx, userSettings) {
    const userId = ctx.from.id;
    const settings = userSettings.get(userId) || { ...defaultSettings };

    const thresholds = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0];
    const keyboard = [];

    for (let i = 0; i < thresholds.length; i += 3) {
        const row = [];
        for (let j = i; j < Math.min(i + 3, thresholds.length); j++) {
            const threshold = thresholds[j];
            const isSelected = settings.kpThreshold === threshold;
            row.push({
                text: isSelected ? `🔘 ${threshold}` : `⚪ ${threshold}`,
                callback_data: `set_kp_${threshold}`,
            });
        }
        keyboard.push(row);
    }

    keyboard.push([
        {
            text: settings.notifications
                ? "🔴 Вимкнути сповіщення"
                : "🟢 Увімкнути сповіщення",
            callback_data: "toggle_notifications",
        },
    ]);
    keyboard.push([{ text: "← Назад", callback_data: "back_to_settings" }]);

    const statusEmoji = settings.notifications ? "🟢" : "🔴";

    const message =
        `🔔 <b>Налаштування сповіщень</b>\n\n` +
        `${statusEmoji} <b>Статус:</b> ${
            settings.notifications ? "Увімкнено" : "Вимкнено"
        }\n` +
        `📈 <b>Поточний поріг:</b> Kp = ${settings.kpThreshold}\n\n` +
        `<b>🔸 Оберіть поріг Kp для сповіщень:</b>\n` +
        `• <b>1.0-2.0</b> 🟢 - дуже часто (будь-яка активність)\n` +
        `• <b>3.0-4.0</b> 🟡 - регулярно (невелика активність)\n` +
        `• <b>5.0-6.0</b> 🟠 - помірно (геомагнітні бурі)\n` +
        `• <b>7.0-9.0</b> 🔴 - рідко (сильні бурі)\n\n` +
        `При досягненні обраного рівня ви отримаєте сповіщення.`;

    await safeEditMessage(ctx, message, {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: "HTML",
    });
}

// Налаштування полярних сяйв
async function showAuroraSettings(ctx, userSettings) {
    const userId = ctx.from.id;
    const settings = userSettings.get(userId) || { ...defaultSettings };

    const statusEmoji = settings.auroraNotifications ? "🟢" : "🔴";
    const statusText = settings.auroraNotifications ? "Увімкнено" : "Вимкнено";

    const keyboard = [];

    if (settings.auroraNotifications) {
        keyboard.push([
            { text: "🔴 Вимкнути сповіщення", callback_data: "disable_aurora" },
        ]);
    } else {
        keyboard.push([
            { text: "🟢 Увімкнути сповіщення", callback_data: "enable_aurora" },
        ]);
    }

    keyboard.push([{ text: "← Назад", callback_data: "back_to_settings" }]);

    const message =
        `🌌 <b>Сповіщення про полярні сяйва</b>\n\n` +
        `${statusEmoji} <b>Статус:</b> ${statusText}\n\n` +
        `<b>🔸 Як це працює:</b>\n` +
        `${
            settings.auroraNotifications
                ? "• Аналізуємо вашу локацію та магнітну широту\n" +
                  "• Коли Kp-індекс досягне рівня для полярних сяйв у вашому регіоні\n" +
                  "• Ви отримаєте сповіщення з порадами для спостереження\n" +
                  "• Сповіщення не частіше раз на 6 годин"
                : "• Сповіщення про полярні сяйва вимкнені\n" +
                  "• Увімкніть для автоматичних попереджень\n" +
                  "• Коли геомагнітна активність дозволить побачити сяйва"
        }`;

    await safeEditMessage(ctx, message, {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: "HTML",
    });
}

// Налаштування щоденного прогнозу
async function showDailySettings(ctx, userSettings) {
    const userId = ctx.from.id;
    const settings = userSettings.get(userId) || { ...defaultSettings };

    const statusEmoji = settings.dailyForecast ? "🟢" : "🔴";
    const statusText = settings.dailyForecast ? "Увімкнено" : "Вимкнено";

    const keyboard = [];

    if (settings.dailyForecast) {
        keyboard.push([
            {
                text: "🔴 Вимкнути щоденний прогноз",
                callback_data: "disable_daily",
            },
        ]);
    } else {
        keyboard.push([
            {
                text: "🟢 Увімкнути щоденний прогноз",
                callback_data: "enable_daily",
            },
        ]);
    }

    keyboard.push([{ text: "← Назад", callback_data: "back_to_settings" }]);

    const message =
        `📊 <b>Щоденний прогноз космічної погоди</b>\n\n` +
        `${statusEmoji} <b>Статус:</b> ${statusText}\n\n` +
        `<b>🔸 Що включено:</b>\n` +
        `${
            settings.dailyForecast
                ? "• Щодня о 08:00 за місцевим часом\n" +
                  "• Прогноз Kp-індексу на день\n" +
                  "• Ймовірність геомагнітних бур\n" +
                  "• Поради для вашого регіону\n" +
                  "• Можливість полярних сяйв"
                : "• Щоденний прогноз вимкнений\n" +
                  "• Увімкніть для отримання ранкового прогнозу\n" +
                  "• Корисно для планування дня"
        }`;

    await safeEditMessage(ctx, message, {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: "HTML",
    });
}

module.exports = {
    showMainSettings,
    showKpThresholdSettings,
    showAuroraSettings,
    showDailySettings,
    safeEditMessage,
    defaultSettings,
};
