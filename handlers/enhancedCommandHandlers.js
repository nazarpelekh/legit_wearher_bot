const { Markup } = require("telegraf");
const EnhancedNOAAService = require("../services/enhancedNoaaService");
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

// Функція показу поточних умов з підтримкою подвійного API
async function showCurrentConditions(ctx, userLocations, geocodingApiKey) {
    const userId = ctx.from.id;

    try {
        const loadingMessage = await ctx.reply(
            "🔄 Завантажую дані з NOAA та SpaceWeatherLive..."
        );

        const [kpData, magnetometerData, solarData] = await Promise.all([
            EnhancedNOAAService.getCurrentKpIndex(),
            EnhancedNOAAService.getMagnetometerData(),
            EnhancedNOAAService.getSolarActivity(),
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
            locationInfo = `📍 **Локація:** ${locationName}\n`;
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

        // Інформація про джерела даних
        let sourceInfo = getSourceInfo(kpData);

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

        const conditionsMessage = `🌌 **Поточні умови космічної погоди**
🕐 Дані оновлені: ${updateTime}
⏰ Зараз: ${currentTime}
${locationInfo}
${sourceInfo}
**🔸 Геомагнітна активність:**
Kp-індекс: ${kpData.kp.toFixed(1)} ${kpStatus.emoji}
Статус: ${kpStatus.status}
${kpStatus.description}

**🔸 Магнітне поле Землі:**
Стан: ${magneticStatus}
${
    magnetometerData
        ? `Дані з: ${FormatUtils.formatTimestamp(
              magnetometerData[magnetometerData.length - 1]?.time_tag
          )}`
        : "Дані недоступні"
}

**🔸 Сонячна активність:**
Рівень: ${solarStatus}
X-ray flux: ${solarData ? "Моніториться" : "Н/Д"}

**🌍 Поради для вашого регіону:**
${getRegionalAdvice(kpStatus.level, kpData.kp, userLocations.get(userId))}`;

        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback("🔄 Оновити", "update_current"),
                Markup.button.callback("📈 Графік", "show_chart"),
            ],
            [
                Markup.button.callback("🔮 Прогноз", "show_forecast"),
                Markup.button.callback("🛰️ Статус API", "api_status"),
            ],
        ]);

        await ctx.deleteMessage(loadingMessage.message_id);
        await ctx.reply(conditionsMessage, keyboard);
    } catch (error) {
        log(`Помилка отримання поточних умов: ${error.message}`);
        await ctx.reply(
            "❌ Помилка отримання даних з API.\n" +
                "Спробуйте пізніше або перевірте інтернет-з'єднання.\n\n" +
                "🔍 Можливі причини:\n" +
                "• Тимчасово недоступні NOAA та SpaceWeatherLive\n" +
                "• Проблеми з мережею\n" +
                "• Технічні роботи на серверах"
        );
    }
}

// Функція для форматування інформації про джерела
function getSourceInfo(kpData) {
    const sourceEmoji = {
        noaa: "🛰️",
        "gfz-potsdam": "🇩🇪",
        fallback: "⚠️",
        generated: "🔧",
    };

    const sourceName = {
        noaa: "NOAA SWPC",
        "gfz-potsdam": "GFZ Potsdam",
        fallback: "Значення за замовчуванням",
        generated: "Згенеровано",
    };

    let sourceInfo = `${sourceEmoji[kpData.source] || "📡"} **Джерело Kp:** ${
        sourceName[kpData.source] || "Невідоме"
    }\n`;

    if (kpData.bothAvailable) {
        sourceInfo += `✅ **Резервне API:** Доступне (${kpData.backupValue})\n`;
        sourceInfo += `🔄 **Правило:** Використано більше значення\n`;
    } else if (kpData.hasBackup === false) {
        sourceInfo += `⚠️ **Резервне API:** ${
            kpData.fallbackReason || "Недоступне"
        }\n`;
    }

    return sourceInfo;
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

// Обробник прогнозу з підтримкою подвійного API
async function handleForecast(ctx, userLocations) {
    try {
        await ctx.reply("🔄 Завантажую прогноз з NOAA та SpaceWeatherLive...");

        const forecast = await EnhancedNOAAService.getForecast();

        if (!forecast || forecast.length === 0) {
            await ctx.reply(
                "📊 Прогнозні дані тимчасово недоступні з усіх джерел.\n\n" +
                    "🔄 Спробуйте команду /current для поточних умов\n" +
                    "📞 Або зв'яжіться пізніше - сервіси оновлюють прогнози двічі на день.\n\n" +
                    "🔍 Перевірені джерела:\n" +
                    "• NOAA Space Weather Prediction Center\n" +
                    "• SpaceWeatherLive API"
            );
            return;
        }

        let forecastMessage = "🔮 **Прогноз космічної погоди**\n\n";

        // Визначаємо джерело та додаємо іконку
        const sourceInfo = forecast[0]?.source;
        const sourceEmoji = {
            noaa: "🛰️",
            spaceweatherlive: "🌐",
            generated: "🔧",
        };

        const sourceName = {
            noaa: "NOAA SWPC",
            spaceweatherlive: "SpaceWeatherLive (резерв)",
            generated: "Згенерований прогноз",
        };

        if (sourceInfo) {
            forecastMessage += `${
                sourceEmoji[sourceInfo] || "📡"
            } **Джерело:** ${sourceName[sourceInfo] || "Невідоме"}\n\n`;
        }

        forecast.forEach((day, index) => {
            const kpMax = parseFloat(day.KpMax || 0);
            const status = FormatUtils.getKpStatus(kpMax);
            const confidence =
                day.confidence ||
                (index === 0 ? "Висока" : index === 1 ? "Помірна" : "Низька");

            forecastMessage += `📅 **${day.DateStamp}**\n`;
            forecastMessage += `Макс. Kp: ${day.KpMax} ${status.emoji}\n`;
            forecastMessage += `Статус: ${status.status}\n`;
            forecastMessage += `Ймовірність бур: ${FormatUtils.getStormProbability(
                kpMax
            )}\n`;
            forecastMessage += `Достовірність: ${confidence}\n\n`;
        });

        // Додаємо поради про полярні сяйва
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
                    "🌌 **Гарні новини!** Протягом наступних днів можливі полярні сяйва у вашому регіоні!\n\n";
            }
        }

        // Інформація про надійність даних
        if (sourceInfo === "noaa") {
            forecastMessage += "✅ **Надійність:** Висока (основне джерело)\n";
        } else if (sourceInfo === "spaceweatherlive") {
            forecastMessage +=
                "🔄 **Надійність:** Помірна (резервне джерело)\n";
            forecastMessage += "💡 **Примітка:** NOAA тимчасово недоступний\n";
        } else if (sourceInfo === "generated") {
            forecastMessage += "⚠️ **Надійність:** Орієнтовна (згенеровано)\n";
            forecastMessage += "🔧 **Примітка:** Всі API недоступні\n";
        }

        forecastMessage += "🔄 **Оновлення:** двічі на день\n";
        forecastMessage += "⚡ **Деталі:** /current - поточні умови";

        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback("🔄 Оновити прогноз", "update_forecast"),
                Markup.button.callback("🌌 Полярні сяйва", "show_aurora"),
            ],
            [
                Markup.button.callback("📊 Поточні дані", "update_current"),
                Markup.button.callback("🛰️ Статус API", "api_status"),
            ],
        ]);

        await ctx.reply(forecastMessage, keyboard);
    } catch (error) {
        log(`Помилка прогнозу: ${error.message}`);
        await ctx.reply(
            "❌ Помилка отримання прогнозу з усіх джерел.\n\n" +
                "🔄 Спробуйте пізніше\n" +
                "📊 Поточні умови: /current\n\n" +
                "🛠️ Технічні деталі:\n" +
                "• Перевірено NOAA SWPC\n" +
                "• Перевірено SpaceWeatherLive\n" +
                "• Згенерований прогноз недоступний"
        );
    }
}

// Обробник полярних сяйв
async function handleAurora(ctx, userLocations, geocodingApiKey) {
    log(`Користувач ${ctx.from.id} запитав прогноз полярних сяйв`);

    const userId = ctx.from.id;
    const userLocation = userLocations.get(userId);

    if (!userLocation) {
        await ctx.reply(
            "📍 **Спершу надішліть свою локацію**\n\n" +
                "Для прогнозу полярних сяйв потрібно знати ваше розташування.",
            Markup.keyboard([
                [Markup.button.locationRequest("📍 Поділитися локацією")],
            ]).resize()
        );
        return;
    }

    try {
        const kpData = await EnhancedNOAAService.getCurrentKpIndex();
        const { latitude, longitude } = userLocation;

        const locationName = await GeoService.getLocationName(
            latitude,
            longitude,
            geocodingApiKey
        );

        // ВАЖЛИВО: перевірити що GeoService.getMagneticLatitude працює правильно
        let magneticLat;
        try {
            magneticLat = GeoService.getMagneticLatitude(latitude, longitude);
        } catch (error) {
            log(`Помилка розрахунку магнітної широти: ${error.message}`);
            // Використовуємо спрощений розрахунок
            magneticLat = latitude - 11; // Приблизне зміщення магнітного полюса
        }

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

        let auroraMessage = `🌌 **Прогноз полярних сяйв**\n\n`;
        auroraMessage += `📍 **Локація:** ${locationName}\n`;
        auroraMessage += `🧭 **Координати:** ${latitude.toFixed(
            4
        )}°, ${longitude.toFixed(4)}°\n`;
        auroraMessage += `🧲 **Магнітна широта:** ${magneticLat.toFixed(
            1
        )}°\n\n`;

        // Додаємо інформацію про джерело Kp
        const sourceEmoji = { noaa: "🛰️", "gfz-potsdam": "🇩🇪", fallback: "⚠️" };
        const sourceName = {
            noaa: "NOAA",
            "gfz-potsdam": "GFZ Potsdam",
            fallback: "За замовчуванням",
        };
        auroraMessage += `${
            sourceEmoji[kpData.source] || "📡"
        } **Джерело Kp:** ${sourceName[kpData.source] || "Невідоме"}\n`;

        if (kpData.bothAvailable) {
            auroraMessage += `🔄 **Резерв:** ${kpData.backupValue} (використано більше)\n`;
        }

        auroraMessage += `**🔸 Поточні умови:**\n`;
        auroraMessage += `Kp-індекс: ${kpData.kp.toFixed(1)}\n`;
        auroraMessage += `Границя авроральному овала: ${auroralBoundary.toFixed(
            1
        )}° маг. широти\n\n`;

        if (canSeeAurora) {
            auroraMessage += `✅ **Полярні сяйва МОЖЛИВІ!**\n`;
            auroraMessage += `🎯 Ви знаходитесь в зоні видимості\n`;
            auroraMessage += `📏 Відстань до центра овала: ${distanceToAurora.toFixed(
                1
            )}°\n\n`;
            auroraMessage += `**🕐 Найкращий час спостереження:**\n${bestTime}\n\n`;
            auroraMessage += `**👀 Поради по спостереженню:**\n`;
            auroraMessage += `• Дивіться на північ\n`;
            auroraMessage += `• Уникайте світлового забруднення\n`;
            auroraMessage += `• Чекайте темного неба\n`;
            auroraMessage += `• Будьте терплячими - активність змінюється\n\n`;
        } else {
            auroraMessage += `❌ **Полярні сяйва МАЛОЙМОВІРНІ**\n`;
            auroraMessage += `📏 Ви знаходитесь на ${distanceToAurora.toFixed(
                1
            )}° південніше зони видимості\n\n`;
            const requiredKp = Math.ceil((67 - Math.abs(magneticLat)) / 2);
            auroraMessage += `**📈 Для видимості потрібно:**\n`;
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

        await ctx.reply(auroraMessage, keyboard);
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
        const alerts = await EnhancedNOAAService.getAlerts();

        if (!alerts || alerts.length === 0) {
            await ctx.reply(
                "✅ **Активних попереджень немає**\n\n" +
                    "Космічна погода спокійна. Ми сповістимо вас про будь-які зміни.\n\n" +
                    "🔔 Увімкніть сповіщення: /settings"
            );
            return;
        }

        let alertsMessage = "⚠️ **Активні попередження:**\n\n";

        alerts.slice(0, 5).forEach((alert, index) => {
            const type = alert.message_type || "Попередження";
            const time = FormatUtils.formatTimestamp(alert.issue_datetime);
            const message = (alert.message || "").substring(0, 150);
            const source = alert.source ? `(${alert.source})` : "";

            alertsMessage += `🚨 **${type}** ${source}\n`;
            alertsMessage += `🕐 ${time}\n`;
            alertsMessage += `📝 ${message}...\n\n`;
        });

        alertsMessage +=
            "📡 Джерело: Комбіновані дані NOAA та SpaceWeatherLive";

        await ctx.reply(alertsMessage);
    } catch (error) {
        log(`Помилка попереджень: ${error.message}`);
        await ctx.reply("❌ Помилка отримання попереджень. Спробуйте пізніше.");
    }
}

// Обробник статусу API
async function handleApiStatus(ctx) {
    try {
        await ctx.answerCbQuery("🔍 Перевіряю статус API...");

        const apiStatus = await EnhancedNOAAService.getApiStatus();

        let statusMessage = "🛰️ **Статус джерел даних**\n\n";

        // NOAA статус
        if (apiStatus.noaa.available) {
            statusMessage += "🟢 **NOAA SWPC:** Доступний\n";
            statusMessage += "📡 Основне джерело космічної погоди\n";
            if (apiStatus.noaa.data) {
                statusMessage += `🔸 Поточний Kp: ${apiStatus.noaa.data.kp}\n\n`;
            }
        } else {
            statusMessage += "🔴 **NOAA SWPC:** Недоступний\n";
            statusMessage += `❌ ${
                apiStatus.noaa.error || "Помилка з'єднання"
            }\n\n`;
        }

        // GFZ Potsdam статус
        if (apiStatus.gfz.available) {
            statusMessage += "🟢 **GFZ Potsdam:** Доступний\n";
            statusMessage += "🇩🇪 Німецька геофізична служба (резерв)\n";
            if (apiStatus.gfz.data) {
                statusMessage += `🔸 Поточний Kp: ${apiStatus.gfz.data.kp}\n\n`;
            }
        } else {
            statusMessage += "🔴 **GFZ Potsdam:** Недоступний\n";
            statusMessage += `❌ ${
                apiStatus.gfz.error || "Резервне джерело недоступне"
            }\n\n`;
        }

        // Загальний статус системи
        const bothWork = apiStatus.noaa.available && apiStatus.gfz.available;
        const oneWorks = apiStatus.noaa.available || apiStatus.gfz.available;

        if (bothWork) {
            statusMessage += "✅ **Загальний статус:** Відмінний\n";
            statusMessage += "🔄 Використовується правило максимального Kp\n";

            // Показуємо яке значення буде вибрано
            if (apiStatus.noaa.data && apiStatus.gfz.data) {
                const noaaKp = apiStatus.noaa.data.kp;
                const gfzKp = apiStatus.gfz.data.kp;
                const selectedKp = Math.max(noaaKp, gfzKp);
                const selectedSource =
                    noaaKp >= gfzKp ? "NOAA SWPC" : "GFZ Potsdam";
                statusMessage += `🎯 **Вибрано:** ${selectedSource} (Kp=${selectedKp})\n`;
            }
        } else if (oneWorks) {
            statusMessage += "🟡 **Загальний статус:** Частково працює\n";
            statusMessage += "⚠️ Одне джерело недоступне, працює резерв\n";
        } else {
            statusMessage +=
                "🔴 **Загальний статус:** Всі джерела недоступні\n";
            statusMessage += "🔧 Використовуватиметься згенерований прогноз\n";
        }

        statusMessage += `\n📝 **Примітка:** SpaceWeatherLive замінено на GFZ Potsdam через блокування API\n`;
        statusMessage += `🕐 **Перевірено:** ${new Date().toLocaleTimeString(
            "uk-UA",
            {
                timeZone: "Europe/Kiev",
            }
        )}\n`;
        statusMessage += "🔄 Дані оновлюються автоматично при кожному запиті";

        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback("🔄 Перевірити знову", "api_status"),
                Markup.button.callback("📊 Поточні дані", "update_current"),
            ],
            [
                Markup.button.callback("🔮 Прогноз", "show_forecast"),
                Markup.button.callback("🌌 Полярні сяйва", "show_aurora"),
            ],
        ]);

        await ctx.reply(statusMessage, keyboard);
    } catch (error) {
        log(`Помилка перевірки статусу API: ${error.message}`);
        await ctx.reply("❌ Помилка перевірки статусу API");
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

module.exports = {
    getMainKeyboard,
    showCurrentConditions,
    handleForecast,
    handleAurora,
    handleAlerts,
    handleApiStatus,
    getBestAuroraTime,
    getRegionalAdvice,
    getSourceInfo,
};
