const {
    showMainSettings,
    showKpThresholdSettings,
    showAuroraSettings,
    showDailySettings,
    defaultSettings,
} = require("./settingsHandlers");
const { handleAurora } = require("./enhancedCommandHandlers");

// Логування
const log = (message) => {
    console.log(`[${new Date().toISOString()}] ${message}`);
};

// Обробка callback_query для налаштувань
async function handleSettingsCallback(
    ctx,
    action,
    userSettings,
    userLocations,
    geocodingApiKey
) {
    const userId = ctx.from.id;

    switch (action) {
        // Налаштування сповіщень
        case "setup_notifications":
            await ctx.answerCbQuery();
            await showKpThresholdSettings(ctx, userSettings);
            break;

        case "setup_aurora":
            await ctx.answerCbQuery();
            await showAuroraSettings(ctx, userSettings);
            break;

        case "setup_daily":
            await ctx.answerCbQuery();
            await showDailySettings(ctx, userSettings);
            break;

        // Встановлення порогу Kp
        case action.match(/^set_kp_/)?.input:
            const threshold = parseFloat(action.replace("set_kp_", ""));
            const settings = userSettings.get(userId) || { ...defaultSettings };
            settings.kpThreshold = threshold;
            userSettings.set(userId, settings);

            await ctx.answerCbQuery(`✅ Поріг встановлено: Kp = ${threshold}`);
            await showKpThresholdSettings(ctx, userSettings);
            break;

        // Перемикач сповіщень
        case "toggle_notifications":
            const userSettings_toggle = userSettings.get(userId) || {
                ...defaultSettings,
            };
            userSettings_toggle.notifications =
                !userSettings_toggle.notifications;
            userSettings.set(userId, userSettings_toggle);

            await ctx.answerCbQuery(
                userSettings_toggle.notifications
                    ? "🔔 Сповіщення увімкнено!"
                    : "🔕 Сповіщення вимкнено!"
            );
            await showKpThresholdSettings(ctx, userSettings);
            break;

        // Перемикачі для Aurora
        case "enable_aurora":
            await ctx.answerCbQuery("🟢 Полярні сяйва увімкнено!");
            const settings_aurora_on = userSettings.get(userId) || {
                ...defaultSettings,
            };
            settings_aurora_on.auroraNotifications = true;
            userSettings.set(userId, settings_aurora_on);
            await showAuroraSettings(ctx, userSettings);
            break;

        case "disable_aurora":
            await ctx.answerCbQuery("🔴 Полярні сяйва вимкнено!");
            const settings_aurora_off = userSettings.get(userId) || {
                ...defaultSettings,
            };
            settings_aurora_off.auroraNotifications = false;
            userSettings.set(userId, settings_aurora_off);
            await showAuroraSettings(ctx, userSettings);
            break;

        // Перемикачі для Daily
        case "enable_daily":
            await ctx.answerCbQuery("🟢 Щоденний прогноз увімкнено!");
            const settings_daily_on = userSettings.get(userId) || {
                ...defaultSettings,
            };
            settings_daily_on.dailyForecast = true;
            userSettings.set(userId, settings_daily_on);
            await showDailySettings(ctx, userSettings);
            break;

        case "disable_daily":
            await ctx.answerCbQuery("🔴 Щоденний прогноз вимкнено!");
            const settings_daily_off = userSettings.get(userId) || {
                ...defaultSettings,
            };
            settings_daily_off.dailyForecast = false;
            userSettings.set(userId, settings_daily_off);
            await showDailySettings(ctx, userSettings);
            break;

        case "reset_settings":
            await ctx.answerCbQuery();
            userSettings.set(userId, { ...defaultSettings });

            const resetMessage =
                `🔧 <b>Налаштування скинуті</b>\n\n` +
                `Всі налаштування повернуті до значень за замовчуванням:\n` +
                `• Сповіщення: вимкнено\n` +
                `• Поріг Kp: 5.0\n` +
                `• Полярні сяйва: увімкнено\n` +
                `• Щоденний прогноз: вимкнено`;

            try {
                await ctx.editMessageText(resetMessage, {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: "← Назад до налаштувань",
                                    callback_data: "back_to_settings",
                                },
                            ],
                        ],
                    },
                    parse_mode: "HTML", // ДОДАТИ
                });
            } catch (error) {
                if (!error.description?.includes("message is not modified")) {
                    log(
                        `Помилка оновлення reset повідомлення: ${error.message}`
                    );
                }
            }
            break;

        case "back_to_settings":
            await ctx.answerCbQuery();
            await showMainSettings(ctx, userSettings);
            break;

        default:
            return false; // Не оброблено
    }
    return true; // Оброблено
}

module.exports = {
    handleSettingsCallback,
};
