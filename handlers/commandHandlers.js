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

// Покращена функція показу поточних умов з сьогоднішнім прогнозом
async function showCurrentConditions(ctx, userLocations, geocodingApiKey) {
    const userId = ctx.from.id;

    try {
        const loadingMessage = await ctx.reply("🔄 Завантажую дані з NOAA...");

        log("=== ПОЧАТОК showCurrentConditions ===");

        // Отримуємо прогноз для визначення поточного Kp
        log("Отримуємо прогноз...");
        const forecast = await EnhancedNOAAService.getForecast();

        if (forecast) {
            log(`Отримано прогноз на ${forecast.length} днів`);
            forecast.forEach((day, index) => {
                log(
                    `День ${index}: ${day.DateStamp}, hourlyData: ${
                        day.hourlyData ? day.hourlyData.length : 0
                    } записів`
                );
            });
        } else {
            log("Прогноз не отримано");
        }

        let currentKpData = null;
        let todayHourlyData = "";

        if (forecast && forecast.length > 0) {
            // Отримуємо поточне значення Kp з прогнозу
            log("Шукаємо поточний Kp в прогнозі...");
            currentKpData = getCurrentKpFromForecast(forecast);

            if (currentKpData) {
                log(
                    `✅ Знайдено поточний Kp з прогнозу: ${currentKpData.kp} (${currentKpData.timeRange})`
                );
            } else {
                log("❌ Не вдалося знайти поточний Kp в прогнозі");
            }

            // Знаходимо сьогоднішні дані з прогнозу
            const today = new Date();
            const todayDay = String(today.getDate()).padStart(2, "0");
            const todayForecast = forecast?.find(
                (day) => day.DateStamp && day.DateStamp.includes(todayDay)
            );

            if (todayForecast && todayForecast.hourlyData) {
                log(
                    `Знайдено сьогоднішній прогноз з ${todayForecast.hourlyData.length} годинами`
                );

                // Фільтруємо тільки майбутні години
                const futureHours = getFutureHourlyData(
                    todayForecast.hourlyData
                );

                if (futureHours.length > 0) {
                    log(`Показуємо ${futureHours.length} майбутніх годин`);
                    todayHourlyData =
                        "\n<b>🕐 Прогноз на сьогодні (київський час):</b>\n";
                    futureHours.forEach((hour) => {
                        const hourKp = parseFloat(hour.kp);
                        const hourStatus = FormatUtils.getKpStatus(hourKp);
                        todayHourlyData += `${hour.timeRange}: ${hour.kp} ${hourStatus.emoji}\n`;
                    });
                } else {
                    log("Немає майбутніх годин для відображення");
                }
            } else {
                log(
                    "Сьогоднішній прогноз не знайдено або немає почасових даних"
                );
            }
        }

        // Якщо не вдалося отримати з прогнозу, використовуємо API
        if (!currentKpData) {
            log("Використовуємо резервний API для поточного Kp");
            const apiKpData = await EnhancedNOAAService.getCurrentKpIndex();
            currentKpData = {
                kp: apiKpData.kp,
                timeRange: null,
                source: apiKpData.source,
            };
            log(
                `Отримано з API: Kp=${currentKpData.kp}, джерело=${currentKpData.source}`
            );
        }

        const kpStatus = FormatUtils.getKpStatus(currentKpData.kp);

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

        const updateTime = new Date().toLocaleString("uk-UA", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Europe/Kiev",
            timeZoneName: "short",
        });

        // Визначаємо джерело даних
        let sourceInfo = "📡 <b>Джерело:</b> ";
        if (currentKpData.source === "forecast") {
            sourceInfo += "NOAA SWPC (прогноз)";
        } else if (currentKpData.source === "noaa") {
            sourceInfo += "NOAA SWPC";
        } else if (currentKpData.source === "gfz-potsdam") {
            sourceInfo += "GFZ Potsdam";
        } else {
            sourceInfo += "Резервне джерело";
        }

        let conditionsMessage = `🌌 <b>Космічна погода</b>
🕐 Оновлено: ${updateTime}
${locationInfo}
${sourceInfo}

<b>🔸 Поточна геомагнітна активність:</b>
Kp-індекс: ${currentKpData.kp.toFixed(1)} ${kpStatus.emoji}`;

        // Додаємо інформацію про часовий інтервал, якщо є
        if (currentKpData.timeRange) {
            conditionsMessage += ` (${currentKpData.timeRange})`;
        }

        conditionsMessage += `
Статус: ${kpStatus.status}
${kpStatus.description}
${todayHourlyData}
<b>🌍 Поради для вашого регіону:</b>
${getRegionalAdvice(
    kpStatus.level,
    currentKpData.kp,
    userLocations.get(userId)
)}`;

        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback("🔄 Оновити", "update_current"),
                Markup.button.callback("📈 Графік 9 год", "show_chart"),
            ],
            [
                Markup.button.callback("🔮 Прогноз", "show_forecast"),
                Markup.button.callback("🌌 Полярні сяйва", "show_aurora"),
            ],
        ]);

        await ctx.deleteMessage(loadingMessage.message_id);
        await ctx.reply(conditionsMessage, { ...keyboard, parse_mode: "HTML" });

        log("=== КІНЕЦЬ showCurrentConditions ===");
    } catch (error) {
        log(`Помилка отримання поточних умов: ${error.message}`);
        try {
            await ctx.deleteMessage(loadingMessage.message_id);
        } catch (deleteError) {
            // Ігноруємо помилки видалення
        }
        await ctx.reply(
            "❌ Помилка отримання даних з NOAA.\n" +
                "Спробуйте пізніше або перевірте інтернет-з'єднання."
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

    let sourceInfo = `${
        sourceEmoji[kpData.source] || "📡"
    } <b>Джерело Kp:</b> ${sourceName[kpData.source] || "Невідоме"}\n`;

    if (kpData.bothAvailable) {
        sourceInfo += `✅ <b>Резервне API:</b> Доступне (${kpData.backupValue})\n`;
        sourceInfo += `🔄 <b>Правило:</b> Використано більше значення\n`;
    } else if (kpData.hasBackup === false) {
        sourceInfo += `⚠️ <b>Резервне API:</b> ${
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

        log("Викликаю EnhancedNOAAService.getForecast()...");
        const forecast = await EnhancedNOAAService.getForecast();
        log(`Отримав прогноз: ${forecast ? forecast.length : 0} днів`);

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

        let forecastMessage = "🔮 <b>Прогноз космічної погоди</b>\n\n";

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
            } <b>Джерело:</b> ${sourceName[sourceInfo] || "Невідоме"}\n\n`;
        }

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
            forecastMessage += `Достовірність: ${confidence}\n`;

            // Додаємо почасовий прогноз
            if (day.hourlyData && day.hourlyData.length > 0) {
                forecastMessage += `\n<b>Почасовий прогноз (київський час):</b>\n`;
                day.hourlyData.forEach((hour) => {
                    const hourKp = parseFloat(hour.kp);
                    const hourStatus = FormatUtils.getKpStatus(hourKp);
                    forecastMessage += `${hour.timeRange}: ${hour.kp} ${hourStatus.emoji}\n`;
                });
            }

            forecastMessage += `\n`;
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
                    "🌌 <b>Гарні новини!</b> Протягом наступних днів можливі полярні сяйва у вашому регіоні!\n\n";
            }
        }

        // Інформація про надійність даних
        if (sourceInfo === "noaa") {
            forecastMessage +=
                "✅ <b>Надійність:</b> Висока (основне джерело)\n";
        } else if (sourceInfo === "spaceweatherlive") {
            forecastMessage +=
                "🔄 <b>Надійність:</b> Помірна (резервне джерело)\n";
            forecastMessage +=
                "💡 <b>Примітка:</b> NOAA тимчасово недоступний\n";
        } else if (sourceInfo === "generated") {
            forecastMessage +=
                "⚠️ <b>Надійність:</b> Орієнтовна (згенеровано)\n";
            forecastMessage += "🔧 <b>Примітка:</b> Всі API недоступні\n";
        }

        forecastMessage += "🔄 <b>Оновлення:</b> двічі на день\n";
        forecastMessage += "⚡ <b>Деталі:</b> /current - поточні умови";

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

        await ctx.reply(forecastMessage, { ...keyboard, parse_mode: "HTML" });
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

    // Додаємо детальне логування для діагностики
    log(`Перевірка локації для користувача ${userId}`);
    log(`Розмір userLocations: ${userLocations.size}`);
    log(`Локація знайдена: ${userLocation ? "так" : "ні"}`);

    if (userLocation) {
        log(
            `Локація: ${userLocation.latitude}, ${userLocation.longitude}, збережена: ${userLocation.timestamp}`
        );
    }

    if (!userLocation) {
        log(`Локація не знайдена для користувача ${userId}`);
        await ctx.reply(
            "📍 <b>Спершу надішліть свою локацію</b>\n\n" +
                "Для прогнозу полярних сяйв потрібно знати ваше розташування.\n\n" +
                "💡 <b>Підказка:</b> Використайте кнопку нижче або надішліть локацію через меню Telegram (📎 → Локація).",
            {
                ...Markup.keyboard([
                    [Markup.button.locationRequest("📍 Поділитися локацією")],
                    ["📊 Поточні дані", "🔮 Прогноз"],
                    ["⚙️ Налаштування"],
                ]).resize(),
                parse_mode: "HTML",
            }
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

        let auroraMessage = `🌌 <b>Прогноз полярних сяйв</b>\n\n`;
        auroraMessage += `📍 <b>Локація:</b> ${locationName}\n`;
        auroraMessage += `🧭 <b>Координати:</b> ${latitude.toFixed(
            4
        )}°, ${longitude.toFixed(4)}°\n`;
        auroraMessage += `🧲 <b>Магнітна широта:</b> ${magneticLat.toFixed(
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
        } <b>Джерело Kp:</b> ${sourceName[kpData.source] || "Невідоме"}\n`;

        if (kpData.bothAvailable) {
            auroraMessage += `🔄 <b>Резерв:</b> ${kpData.backupValue} (використано більше)\n`;
        }

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
        const alerts = await EnhancedNOAAService.getAlerts();

        if (!alerts || alerts.length === 0) {
            await ctx.reply(
                "✅ <b>Активних попереджень немає</b>\n\n" +
                    "Космічна погода спокійна. Ми сповістимо вас про будь-які зміни.\n\n" +
                    "🔔 Увімкніть сповіщення: /settings",
                { parse_mode: "HTML" }
            );
            return;
        }

        let alertsMessage = "⚠️ <b>Активні попередження:</b>\n\n";

        alerts.slice(0, 5).forEach((alert, index) => {
            const type = alert.message_type || "Попередження";
            const time = FormatUtils.formatTimestamp(alert.issue_datetime);
            const message = (alert.message || "").substring(0, 150);
            const source = alert.source ? `(${alert.source})` : "";

            alertsMessage += `🚨 <b>${type}</b> ${source}\n`;
            alertsMessage += `🕐 ${time}\n`;
            alertsMessage += `📝 ${message}...\n\n`;
        });

        alertsMessage +=
            "📡 Джерело: Комбіновані дані NOAA та SpaceWeatherLive";

        await ctx.reply(alertsMessage, { parse_mode: "HTML" });
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

        let statusMessage = "🛰️ <b>Статус джерел даних</b>\n\n";

        // NOAA статус
        if (apiStatus.noaa.available) {
            statusMessage += "🟢 <b>NOAA SWPC:</b> Доступний\n";
            statusMessage += "📡 Основне джерело космічної погоди\n";
            if (apiStatus.noaa.data) {
                statusMessage += `🔸 Поточний Kp: ${apiStatus.noaa.data.kp}\n\n`;
            }
        } else {
            statusMessage += "🔴 <b>NOAA SWPC:</b> Недоступний\n";
            statusMessage += `❌ ${
                apiStatus.noaa.error || "Помилка з'єднання"
            }\n\n`;
        }

        // GFZ Potsdam статус
        if (apiStatus.gfz.available) {
            statusMessage += "🟢 <b>GFZ Potsdam:</b> Доступний\n";
            statusMessage += "🇩🇪 Німецька геофізична служба (резерв)\n";
            if (apiStatus.gfz.data) {
                statusMessage += `🔸 Поточний Kp: ${apiStatus.gfz.data.kp}\n\n`;
            }
        } else {
            statusMessage += "🔴 <b>GFZ Potsdam:</b> Недоступний\n";
            statusMessage += `❌ ${
                apiStatus.gfz.error || "Резервне джерело недоступне"
            }\n\n`;
        }

        // Загальний статус системи
        const bothWork = apiStatus.noaa.available && apiStatus.gfz.available;
        const oneWorks = apiStatus.noaa.available || apiStatus.gfz.available;

        if (bothWork) {
            statusMessage += "✅ <b>Загальний статус:</b> Відмінний\n";
            statusMessage += "🔄 Використовується правило максимального Kp\n";

            // Показуємо яке значення буде вибрано
            if (apiStatus.noaa.data && apiStatus.gfz.data) {
                const noaaKp = apiStatus.noaa.data.kp;
                const gfzKp = apiStatus.gfz.data.kp;
                const selectedKp = Math.max(noaaKp, gfzKp);
                const selectedSource =
                    noaaKp >= gfzKp ? "NOAA SWPC" : "GFZ Potsdam";
                statusMessage += `🎯 <b>Вибрано:</b> ${selectedSource} (Kp=${selectedKp})\n`;
            }
        } else if (oneWorks) {
            statusMessage += "🟡 <b>Загальний статус:</b> Частково працює\n";
            statusMessage += "⚠️ Одне джерело недоступне, працює резерв\n";
        } else {
            statusMessage +=
                "🔴 <b>Загальний статус:</b> Всі джерела недоступні\n";
            statusMessage += "🔧 Використовуватиметься згенерований прогноз\n";
        }

        statusMessage += `\n📝 <b>Примітка:</b> SpaceWeatherLive замінено на GFZ Potsdam через блокування API\n`;
        statusMessage += `🕐 <b>Перевірено:</b> ${new Date().toLocaleTimeString(
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

        await ctx.reply(statusMessage, { ...keyboard, parse_mode: "HTML" });
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
    //handleFeedback,
    getBestAuroraTime,
    getRegionalAdvice,
    getSourceInfo,
};
