const { Markup } = require("telegraf");
const NOAAService = require("../services/noaaService");
const GeoService = require("../services/geoService");
const FormatUtils = require("../utils/formatUtils");

// Логування
const log = (message) => {
    console.log(`[${new Date().toISOString()}] ${message}`);
};

// Функція для основної клавіатури
function getMainKeyboard() {
    return Markup.keyboard([
        ["📊 Поточні дані", "🔮 Прогноз"],
        ["🌌 Полярні сяйва", "⚠️ Попередження"],
        [Markup.button.locationRequest("📍 Оновити локацію")],
        ["⚙️ Налаштування"],
    ]).resize();
}

// Функція показу поточних умов
async function showCurrentConditions(ctx, userLocations, geocodingApiKey) {
    const userId = ctx.from.id;

    try {
        const loadingMessage = await ctx.reply(
            "🔄 Завантажую дані з супутників NOAA..."
        );

        const [kpData, magnetometerData, solarData] = await Promise.all([
            NOAAService.getCurrentKpIndex(),
            NOAAService.getMagnetometerData(),
            NOAAService.getSolarActivity(),
        ]);

        const kpStatus = FormatUtils.getKpStatus(kpData.kp);

        let locationInfo = "";
        if (userLocations.has(userId)) {
            const location = userLocations.get(userId);
            const locationName = await GeoService.getLocationName(
                location.latitude,
                location.longitude,
                geocodingApiKey
            );
            locationInfo = `📍 <b>Локація:</b> ${locationName}\n`;
        }

        const updateTime = FormatUtils.formatTimestamp(kpData.timestamp);
        const currentTime = new Date().toLocaleString("uk-UA", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Europe/Kiev",
            timeZoneName: "short",
        });

        let magneticStatus = "Стабільне";
        if (magnetometerData && magnetometerData.length > 0) {
            const latest = magnetometerData[magnetometerData.length - 1];
            const hp = parseFloat(latest.Hp || 0);
            if (hp > 50) magneticStatus = "Збурене";
            else if (hp > 30) magneticStatus = "Помірно активне";
        }

        let solarStatus = "Помірна";
        if (solarData && solarData.length > 0) {
            const latest = solarData[solarData.length - 1];
            const flux = parseFloat(latest.flux || 0);
            if (flux > 1e-5) solarStatus = "Підвищена";
            else if (flux < 1e-7) solarStatus = "Низька";
        }

        const conditionsMessage = `🌌 <b>Поточні умови космічної погоди</b>
🕐 Дані NOAA: ${updateTime}
⏰ Зараз: ${currentTime}
${locationInfo}
<b>🔸 Геомагнітна активність:</b>
Kp-індекс: ${kpData.kp.toFixed(1)} ${kpStatus.emoji}
Статус: ${kpStatus.status}
${kpStatus.description}

<b>🔸 Магнітне поле Землі:</b>
Стан: ${magneticStatus}
${
    magnetometerData
        ? `Дані з: ${FormatUtils.formatTimestamp(
              magnetometerData[magnetometerData.length - 1]?.time_tag
          )}`
        : "Дані недоступні"
}

<b>🔸 Сонячна активність:</b>
Рівень: ${solarStatus}
X-ray flux: ${solarData ? "Моніториться" : "Н/Д"}

<b>🌍 Поради для вашого регіону:</b>
${getRegionalAdvice(kpStatus.level, kpData.kp, userLocations.get(userId))}`;

        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback("🔄 Оновити", "update_current"),
                Markup.button.callback("📈 Графік", "show_chart"),
            ],
            [
                Markup.button.callback("🔮 Прогноз", "show_forecast"),
                Markup.button.callback("⚠️ Алерти", "show_alerts"),
            ],
        ]);

        await ctx.deleteMessage(loadingMessage.message_id);
        await ctx.reply(conditionsMessage, { ...keyboard, parse_mode: "HTML" });
    } catch (error) {
        log(`Помилка отримання поточних умов: ${error.message}`);
        await ctx.reply(
            "❌ Помилка отримання даних з NOAA.\n" +
                "Спробуйте пізніше або перевірте інтернет-з'єднання."
        );
    }
}

// Регіональні поради
function getRegionalAdvice(level, kpValue, location) {
    const isHighLatitude = location && Math.abs(location.latitude) > 50;

    switch (level) {
        case "low":
            return "✅ Всі системи працюють нормально";
        case "minor":
            return "📡 Можливі незначні проблеми з GPS";
        case "moderate":
            return isHighLatitude
                ? "🌌 Можливі полярні сяйва! Перевірте GPS точність"
                : "📡 Рекомендується перевірити GPS точність";
        case "strong":
            return isHighLatitude
                ? "🚨 Очікуються яскраві полярні сяйва! Обережно з GPS та радіо"
                : "⚠️ Можливі серйозні порушення навігації та зв'язку";
        case "extreme":
            return "🚨 Критична ситуація! Можливі відключення електроенергії";
        default:
            return "";
    }
}

// Обробник прогнозу
async function handleForecast(ctx, userLocations) {
    try {
        await ctx.reply("🔄 Завантажую прогноз з NOAA...");

        const forecast = await NOAAService.getForecast();

        if (!forecast || forecast.length === 0) {
            await ctx.reply(
                "📊 Прогнозні дані тимчасово недоступні.\n\n" +
                    "🔄 Спробуйте команду /current для поточних умов\n" +
                    "📞 Або зв'яжіться пізніше - NOAA оновлює прогнози двічі на день."
            );
            return;
        }

        let forecastMessage = "🔮 <b>Прогноз космічної погоди</b>\n\n";

        forecast.forEach((day, index) => {
            const kpMax = parseFloat(day.KpMax || 0);
            const status = FormatUtils.getKpStatus(kpMax);
            const confidence =
                day.confidence ||
                (index === 0 ? "Висока" : index === 1 ? "Помірна" : "Низька");

            forecastMessage += `📅 <b>${day.DateStamp}</b>\n`;
            forecastMessage += `Макс. Kp: ${day.KpMax} ${status.emoji}\n`;
            forecastMessage += `Статус: ${status.status}\n`;
            forecastMessage += `Ймовірність бур: ${FormatUtils.getStormProbability(
                kpMax
            )}\n`;
            forecastMessage += `Достовірність: ${confidence}\n\n`;
        });

        // Додаємо поради
        const maxKpInForecast = Math.max(
            ...forecast.map((d) => parseFloat(d.KpMax || 0))
        );
        const userId = ctx.from.id;
        const userLocation = userLocations.get(userId);

        if (userLocation && maxKpInForecast >= 5) {
            const canSeeAurora = GeoService.canSeeAurora(
                userLocation.latitude,
                userLocation.longitude,
                maxKpInForecast
            );

            if (canSeeAurora) {
                forecastMessage +=
                    "🌌 <b>Гарні новини!</b> Протягом наступних днів можливі полярні сяйва у вашому регіоні!\n\n";
            }
        }

        forecastMessage +=
            "📊 <b>Джерело:</b> NOAA Space Weather Prediction Center\n";
        forecastMessage +=
            "🔄 <b>Оновлення:</b> двічі на день (06:00, 18:00 UTC)\n";
        forecastMessage += "⚡ <b>Деталі:</b> /current - поточні умови";

        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback("🔄 Оновити прогноз", "update_forecast"),
                Markup.button.callback("🌌 Полярні сяйва", "show_aurora"),
            ],
        ]);

        await ctx.reply(forecastMessage, { ...keyboard, parse_mode: "HTML" });
    } catch (error) {
        log(`Помилка прогнозу: ${error.message}`);
        await ctx.reply(
            "❌ Помилка отримання прогнозу.\n\n" +
                "🔄 Спробуйте пізніше - можливо, NOAA оновлює дані\n" +
                "📊 Поточні умови: /current"
        );
    }
}

// Функція для визначення найкращого часу спостереження
function getBestAuroraTime(latitude) {
    return (
        `🌙 22:00 - 02:00 місцевого часу\n` +
        `⭐ Найкраща активність близько опівночі\n` +
        `🌅 Уникайте світанку та заходу сонця`
    );
}

// Обробник полярних сяйв
async function handleAurora(ctx, userLocations, geocodingApiKey) {
    log(`Користувач ${ctx.from.id} запитав прогноз полярних сяйв`);

    const userId = ctx.from.id;
    const userLocation = userLocations.get(userId);

    if (!userLocation) {
        await ctx.reply(
            "📍 <b>Спершу надішліть свою локацію</b>\n\n" +
                "Для прогнозу полярних сяйв потрібно знати ваше розташування.",
            Markup.keyboard([
                [Markup.button.locationRequest("📍 Поділитися локацією")],
            ]).resize()
        );
        return;
    }

    try {
        const kpData = await NOAAService.getCurrentKpIndex();
        const { latitude, longitude } = userLocation;

        const locationName = await GeoService.getLocationName(
            latitude,
            longitude,
            geocodingApiKey
        );
        const magneticLat = GeoService.getMagneticLatitude(latitude, longitude);
        const canSeeAurora = GeoService.canSeeAurora(
            latitude,
            longitude,
            kpData.kp
        );

        const auroralBoundary = 67 - 2 * kpData.kp;
        const distanceToAurora = Math.abs(
            Math.abs(magneticLat) - auroralBoundary
        );
        const bestTime = getBestAuroraTime(latitude);

        let auroraMessage = `🌌 <b>Прогноз полярних сяйв</b>\n\n`;
        auroraMessage += `📍 <b>Локація:</b> ${locationName}\n`;
        auroraMessage += `🧭 <b>Координати:</b> ${latitude.toFixed(
            4
        )}°, ${longitude.toFixed(4)}°\n`;
        auroraMessage += `🧲 <b>Магнітна широта:</b> ${magneticLat.toFixed(
            1
        )}°\n\n`;

        auroraMessage += `<b>🔸 Поточні умови:</b>\n`;
        auroraMessage += `Kp-індекс: ${kpData.kp.toFixed(1)}\n`;
        auroraMessage += `Границя авроральному овала: ${auroralBoundary.toFixed(
            1
        )}° маг. широти\n\n`;

        if (canSeeAurora) {
            auroraMessage += `✅ <b>Полярні сяйва МОЖЛИВІ!</b>\n`;
            auroraMessage += `🎯 Ви знаходитесь в зоні видимості\n`;
            auroraMessage += `📏 Відстань до центра овала: ${distanceToAurora.toFixed(
                1
            )}°\n\n`;
            auroraMessage += `<b>🕐 Найкращий час спостереження:</b>\n${bestTime}\n\n`;
            auroraMessage += `<b>👀 Поради по спостереженню:</b>\n`;
            auroraMessage += `• Дивіться на північ\n`;
            auroraMessage += `• Уникайте світлового забруднення\n`;
            auroraMessage += `• Чекайте темного неба\n`;
            auroraMessage += `• Будьте терплячими - активність змінюється\n\n`;
        } else {
            auroraMessage += `❌ <b>Полярні сяйва МАЛОЙМОВІРНІ</b>\n`;
            auroraMessage += `📏 Ви знаходитесь на ${distanceToAurora.toFixed(
                1
            )}° південніше зони видимості\n\n`;
            const requiredKp = Math.ceil((67 - Math.abs(magneticLat)) / 2);
            auroraMessage += `<b>📈 Для видимості потрібно:</b>\n`;
            auroraMessage += `Kp ≥ ${requiredKp} (зараз ${kpData.kp.toFixed(
                1
            )})\n\n`;
        }

        auroraMessage += `📊 Дані оновлюються кожні 3 години\n`;
        auroraMessage += `🔄 /current - загальний стан космічної погоди`;

        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback("🔄 Оновити прогноз", "update_aurora"),
                Markup.button.callback(
                    "📈 3-день прогноз",
                    "aurora_forecast_3day"
                ),
            ],
        ]);

        await ctx.reply(auroraMessage, { ...keyboard, parse_mode: "HTML" });
    } catch (error) {
        log(`Помилка aurora команди: ${error.message}`);
        await ctx.reply(
            "❌ Помилка отримання даних полярних сяйв. Спробуйте пізніше."
        );
    }
}

// Обробник попереджень
async function handleAlerts(ctx) {
    try {
        const alerts = await NOAAService.getAlerts();

        if (!alerts || alerts.length === 0) {
            await ctx.reply(
                "✅ <b>Активних попереджень немає</b>\n\n" +
                    "Космічна погода спокійна. Ми сповістимо вас про будь-які зміни.\n\n" +
                    "🔔 Увімкніть сповіщення: /settings"
            );
            return;
        }

        let alertsMessage = "⚠️ <b>Активні попередження:</b>\n\n";

        alerts.slice(0, 5).forEach((alert, index) => {
            const type = alert.message_type || "Попередження";
            const time = FormatUtils.formatTimestamp(alert.issue_datetime);
            const message = (alert.message || "").substring(0, 150);

            alertsMessage +=
                `🚨 <b>${type}</b>\n` + `🕐 ${time}\n` + `📝 ${message}...\n\n`;
        });

        alertsMessage += "📡 Джерело: NOAA Space Weather Prediction Center";

        await ctx.reply(alertsMessage, { parse_mode: "HTML" });
    } catch (error) {
        log(`Помилка попереджень: ${error.message}`);
        await ctx.reply("❌ Помилка отримання попереджень. Спробуйте пізніше.");
    }
}

module.exports = {
    getMainKeyboard,
    showCurrentConditions,
    handleForecast,
    handleAurora,
    handleAlerts,
    getBestAuroraTime,
    getRegionalAdvice,
};
