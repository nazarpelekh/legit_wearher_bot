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

// Функція для парсингу текстового прогнозу NOAA
function parseNoaaTextForecast(textData) {
    const lines = textData.split("\n");
    const result = {
        days: [],
        hourlyData: [],
    };

    let datesLine = null;
    let dates = [];

    log("Почали парсинг текстового прогнозу NOAA");

    // Шукаємо рядок з датами
    for (const line of lines) {
        if (
            line.includes("Sep") ||
            line.includes("Oct") ||
            line.includes("Nov") ||
            line.includes("Jan") ||
            line.includes("Feb") ||
            line.includes("Mar") ||
            line.includes("Apr") ||
            line.includes("May") ||
            line.includes("Jun") ||
            line.includes("Jul") ||
            line.includes("Aug") ||
            line.includes("Dec")
        ) {
            // Знаходимо всі дати в рядку
            const dateRegex = /(\w{3})\s+(\d{1,2})/g;
            const dateMatches = [...line.matchAll(dateRegex)];

            if (dateMatches.length >= 2) {
                dates = dateMatches.map((match) => ({
                    month: match[1],
                    day: parseInt(match[2]),
                }));
                datesLine = line;
                break;
            }
        }
    }

    if (dates.length === 0) {
        log("Не знайдено дат в прогнозі");
        return null;
    }

    log(`Знайдено дати: ${dates.map((d) => `${d.month} ${d.day}`).join(", ")}`);

    // Конвертуємо дати в український формат
    const monthNames = {
        Jan: "Січня",
        Feb: "Лютого",
        Mar: "Березня",
        Apr: "Квітня",
        May: "Травня",
        Jun: "Червня",
        Jul: "Липня",
        Aug: "Серпня",
        Sep: "Вересня",
        Oct: "Жовтня",
        Nov: "Листопада",
        Dec: "Грудня",
    };

    // Ініціалізуємо дні
    dates.forEach((date) => {
        result.days.push({
            dateStamp: `${String(date.day).padStart(2, "0")} ${
                monthNames[date.month]
            }`,
            originalDate: date,
            maxKp: 0,
            hourlyData: [],
        });
    });

    // Парсимо почасові дані
    for (const line of lines) {
        const utcMatch = line.match(/^(\d{2}-\d{2})UT\s+(.+)$/);
        if (utcMatch) {
            const timeRange = utcMatch[1]; // наприклад "09-12"
            const kpValues = utcMatch[2].trim().split(/\s+/);

            const [startHour, endHour] = timeRange.split("-").map(Number);

            // Конвертуємо UTC в київський час (+3 години)
            let kyivStart = (startHour + 3) % 24;
            let kyivEnd = (endHour + 3) % 24;

            // Обробка переходу через північ
            if (endHour === 0) {
                kyivEnd = 3;
            }

            const kyivTimeRange = `${String(kyivStart).padStart(
                2,
                "0"
            )}:00-${String(kyivEnd).padStart(2, "0")}:00`;

            log(`UTC ${timeRange} → Київ ${kyivTimeRange}`);

            kpValues.forEach((kpStr, dayIndex) => {
                if (dayIndex < result.days.length && kpStr && kpStr !== "-") {
                    const kpValue = parseFloat(kpStr);
                    if (!isNaN(kpValue)) {
                        // Визначаємо до якого дня належить цей час
                        let targetDayIndex = dayIndex;

                        // Якщо київський час переходить на наступний день (21-00 UTC стає 00-03 Київ наступного дня)
                        if (startHour >= 21 && kyivStart < 6) {
                            targetDayIndex = Math.min(
                                dayIndex + 1,
                                result.days.length - 1
                            );
                        }

                        if (targetDayIndex < result.days.length) {
                            result.days[targetDayIndex].hourlyData.push({
                                timeRange: kyivTimeRange,
                                kp: kpValue.toFixed(1),
                                utcTime: timeRange,
                                originalHour: startHour,
                            });

                            // Оновлюємо максимальний Kp
                            result.days[targetDayIndex].maxKp = Math.max(
                                result.days[targetDayIndex].maxKp,
                                kpValue
                            );
                        }
                    }
                }
            });
        }
    }

    // Сортуємо почасові дані за часом
    result.days.forEach((day, index) => {
        day.hourlyData.sort((a, b) => {
            const aHour = parseInt(a.timeRange.split(":")[0]);
            const bHour = parseInt(b.timeRange.split(":")[0]);
            return aHour - bHour;
        });
        day.maxKp = day.maxKp.toFixed(1);

        log(
            `День ${index} (${day.dateStamp}): ${day.hourlyData.length} інтервалів, макс Kp: ${day.maxKp}`
        );
    });

    return result;
}

// Функція для отримання поточного Kp з текстового прогнозу
function getCurrentKpFromTextForecast(parsedForecast) {
    if (!parsedForecast || !parsedForecast.days.length) {
        log("Немає розпарсеного прогнозу");
        return null;
    }

    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDate();

    log(
        `Поточний час: ${currentHour}:${now.getMinutes()}, день: ${currentDay}`
    );

    // Знаходимо сьогоднішній день
    const todayData = parsedForecast.days.find((day) => {
        const dayNum = day.originalDate.day;
        return dayNum === currentDay;
    });

    if (!todayData || !todayData.hourlyData.length) {
        log("Не знайдено дані на сьогодні");
        log(
            `Доступні дні: ${parsedForecast.days
                .map((d) => d.originalDate.day)
                .join(", ")}`
        );
        return null;
    }

    log(
        `Знайдено дані на сьогодні з ${todayData.hourlyData.length} інтервалами`
    );

    // Шукаємо відповідний часовий інтервал
    for (const hourData of todayData.hourlyData) {
        const [startTime, endTime] = hourData.timeRange.split("-");
        const startHour = parseInt(startTime.split(":")[0]);
        const endHour = parseInt(endTime.split(":")[0]);

        let isInRange = false;
        if (endHour > startHour) {
            isInRange = currentHour >= startHour && currentHour < endHour;
        } else {
            // Перехід через північ
            isInRange = currentHour >= startHour || currentHour < endHour;
        }

        log(
            `Перевіряємо інтервал ${hourData.timeRange}: ${startHour}-${endHour}, поточний: ${currentHour}, підходить: ${isInRange}`
        );

        if (isInRange) {
            log(
                `✅ Знайдено поточний інтервал: ${hourData.timeRange}, Kp: ${hourData.kp}`
            );
            return {
                kp: parseFloat(hourData.kp),
                timeRange: hourData.timeRange,
                source: "noaa-forecast",
            };
        }
    }

    log("❌ Не знайдено відповідного часового інтервалу");
    return null;
}

// Функція для отримання майбутніх інтервалів ТІЛЬКИ на сьогодні
function getTodayFutureIntervalsFromTextForecast(parsedForecast) {
    if (!parsedForecast || !parsedForecast.days.length) {
        return [];
    }

    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDate();

    const futureIntervals = [];

    // Беремо ТІЛЬКИ майбутні інтервали сьогодні
    const todayData = parsedForecast.days.find((day) => {
        const dayNum = day.originalDate.day;
        return dayNum === currentDay;
    });

    if (todayData) {
        const todayFuture = todayData.hourlyData.filter((hourData) => {
            const startHour = parseInt(hourData.timeRange.split(":")[0]);
            return startHour > currentHour;
        });

        log(`Сьогодні майбутніх інтервалів: ${todayFuture.length}`);

        futureIntervals.push(
            ...todayFuture.map((h) => ({
                ...h,
                date: todayData.dateStamp,
            }))
        );
    }

    log(`Сьогодні майбутніх інтервалів: ${futureIntervals.length}`);
    return futureIntervals;
}

// Функція показу поточних умов (тільки сьогодні)
async function showCurrentConditions(ctx, userLocations, geocodingApiKey) {
    const userId = ctx.from.id;

    try {
        const loadingMessage = await ctx.reply("🔄 Завантажую дані з NOAA...");

        log("=== ПОЧАТОК showCurrentConditions ===");

        // Отримуємо текстовий прогноз напряму
        log("Отримуємо текстовий прогноз NOAA...");
        const textForecast = await EnhancedNOAAService.getNoaaData(
            "/text/3-day-geomag-forecast.txt"
        );

        if (!textForecast) {
            throw new Error("Не вдалося отримати текстовий прогноз");
        }

        log("Текстовий прогноз отримано, парсимо...");
        const parsedForecast = parseNoaaTextForecast(textForecast);

        if (!parsedForecast) {
            throw new Error("Не вдалося парсити прогноз");
        }

        log("Прогноз успішно розпарсено");

        // Отримуємо поточний Kp
        let currentKpData = getCurrentKpFromTextForecast(parsedForecast);

        // Якщо не знайшли в прогнозі, використовуємо API
        if (!currentKpData) {
            log(
                "Не знайдено поточний Kp в прогнозі, використовуємо резервний API"
            );
            const apiKpData = await EnhancedNOAAService.getCurrentKpIndex();
            currentKpData = {
                kp: apiKpData.kp,
                timeRange: null,
                source: apiKpData.source,
            };
        }

        // Отримуємо ТІЛЬКИ сьогоднішні майбутні інтервали
        const todayFutureIntervals =
            getTodayFutureIntervalsFromTextForecast(parsedForecast);

        let todayHourlyData = "";
        if (todayFutureIntervals.length > 0) {
            todayHourlyData =
                "\n<b>🕐 Прогноз на сьогодні (київський час):</b>\n";

            todayFutureIntervals.forEach((interval) => {
                const hourKp = parseFloat(interval.kp);
                const hourStatus = FormatUtils.getKpStatus(hourKp);
                todayHourlyData += `${interval.timeRange}: ${interval.kp} ${hourStatus.emoji}\n`;
            });
        } else {
            todayHourlyData =
                "\n<i>Сьогодні більше немає прогнозованих інтервалів</i>\n";
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
        if (currentKpData.source === "noaa-forecast") {
            sourceInfo += "NOAA SWPC (текстовий прогноз)";
        } else if (currentKpData.source === "noaa") {
            sourceInfo += "NOAA SWPC (API)";
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
        log(`Помилка: ${error.message}`);
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

// Функція для повного 3-денного прогнозу
async function handleForecast(ctx, userLocations) {
    try {
        const loadingMessage = await ctx.reply(
            "🔄 Завантажую 3-денний прогноз з NOAA..."
        );

        log("=== ПОЧАТОК handleForecast ===");

        // Отримуємо текстовий прогноз напряму
        const textForecast = await EnhancedNOAAService.getNoaaData(
            "/text/3-day-geomag-forecast.txt"
        );

        if (!textForecast) {
            await ctx.deleteMessage(loadingMessage.message_id);
            await ctx.reply(
                "📊 Прогнозні дані тимчасово недоступні з NOAA.\n\n" +
                    "🔄 Спробуйте команду /current для поточних умов\n" +
                    "📞 Або зв'яжіться пізніше - NOAA оновлює прогнози двічі на день."
            );
            return;
        }

        const parsedForecast = parseNoaaTextForecast(textForecast);

        if (!parsedForecast || !parsedForecast.days.length) {
            await ctx.deleteMessage(loadingMessage.message_id);
            await ctx.reply("❌ Не вдалося розпарсити прогноз NOAA.");
            return;
        }

        let forecastMessage = "🔮 <b>Прогноз космічної погоди на 3 дні</b>\n\n";
        forecastMessage +=
            "📡 <b>Джерело:</b> NOAA SWPC (текстовий прогноз)\n\n";

        // Показуємо всі 3 дні з повними почасовими даними
        parsedForecast.days.forEach((day, index) => {
            const maxKp = parseFloat(day.maxKp);
            const status = FormatUtils.getKpStatus(maxKp);

            forecastMessage += `📅 <b>${day.dateStamp}</b>\n`;
            forecastMessage += `Макс. Kp: ${day.maxKp} ${status.emoji}\n`;
            forecastMessage += `Статус: ${status.status}\n`;
            forecastMessage += `Ймовірність бур: ${FormatUtils.getStormProbability(
                maxKp
            )}\n`;

            // Додаємо почасовий прогноз для кожного дня
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
            ...parsedForecast.days.map((d) => parseFloat(d.maxKp))
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
            "✅ <b>Надійність:</b> Висока (офіційний NOAA прогноз)\n";
        forecastMessage +=
            "🔄 <b>Оновлення:</b> двічі на день (06:00, 18:00 UTC)\n";
        forecastMessage += "⚡ <b>Поточні умови:</b> /current";

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

        await ctx.deleteMessage(loadingMessage.message_id);
        await ctx.reply(forecastMessage, { ...keyboard, parse_mode: "HTML" });

        log("=== КІНЕЦЬ handleForecast ===");
    } catch (error) {
        log(`Помилка прогнозу: ${error.message}`);
        try {
            await ctx.deleteMessage(loadingMessage.message_id);
        } catch (deleteError) {}
        await ctx.reply(
            "❌ Помилка отримання прогнозу з NOAA.\n\n" +
                "🔄 Спробуйте пізніше\n" +
                "📊 Поточні умови: /current"
        );
    }
}

// Функція для форматування інформації про джерела
function getSourceInfo(kpData) {
    const sourceEmoji = {
        noaa: "🛰️",
        "gfz-potsdam": "🇩🇪",
        "noaa-forecast": "📋",
        fallback: "⚠️",
        generated: "🔧",
    };

    const sourceName = {
        noaa: "NOAA SWPC",
        "gfz-potsdam": "GFZ Potsdam",
        "noaa-forecast": "NOAA прогноз",
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

// Обробник полярних сяйв
async function handleAurora(ctx, userLocations, geocodingApiKey) {
    log(`Користувач ${ctx.from.id} запитав прогноз полярних сяйв`);

    const userId = ctx.from.id;
    const userLocation = userLocations.get(userId);

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

        let magneticLat;
        try {
            magneticLat = GeoService.getMagneticLatitude(latitude, longitude);
        } catch (error) {
            log(`Помилка розрахунку магнітної широти: ${error.message}`);
            magneticLat = latitude - 11;
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

// Функція для отримання даних за останні 9 годин з текстового прогнозу
function getLast9HoursData(parsedForecast) {
    if (!parsedForecast || !parsedForecast.days.length) {
        return [];
    }

    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.getDate();

    let allHourlyData = [];

    // Збираємо всі годинні дані з усіх днів
    parsedForecast.days.forEach((day) => {
        if (day.hourlyData) {
            day.hourlyData.forEach((hourData) => {
                const [startTime] = hourData.timeRange.split("-");
                const hour = parseInt(startTime.split(":")[0]);

                allHourlyData.push({
                    ...hourData,
                    hour: hour,
                    day: day.originalDate.day,
                    dateStamp: day.dateStamp,
                });
            });
        }
    });

    // Знаходимо поточний момент в даних
    let currentIndex = -1;
    for (let i = 0; i < allHourlyData.length; i++) {
        const data = allHourlyData[i];
        if (data.day === currentDay && data.hour <= currentHour) {
            currentIndex = i;
        }
    }

    if (currentIndex === -1) {
        // Якщо не знайшли точно поточний час, беремо останні доступні дані
        currentIndex = allHourlyData.length - 1;
    }

    // Беремо 9 годин: 8 попередніх + поточна
    const startIndex = Math.max(0, currentIndex - 8);
    const last9Hours = allHourlyData.slice(startIndex, currentIndex + 1);

    log(`Знайдено ${last9Hours.length} годинних записів для графіку`);

    return last9Hours;
}

// Фінальна версія функції з правильно вирівняними числами
function createKpChart(hourlyData) {
    if (!hourlyData || hourlyData.length === 0) {
        return "Немає даних для відображення графіку";
    }

    const maxKp = Math.max(...hourlyData.map((d) => parseFloat(d.kp)));
    const minKp = Math.min(...hourlyData.map((d) => parseFloat(d.kp)));
    const range = Math.max(maxKp - minKp, 1); // мінімальний діапазон 1

    let chart = "📈 <b>Графік Kp-індексу (останні 9 годин)</b>\n\n";

    // Створюємо вертикальний ASCII графік
    const chartHeight = 8;
    const chartLines = [];

    for (let row = chartHeight; row >= 0; row--) {
        let line = "";
        const value = minKp + (range * row) / chartHeight;

        // Масштаб зліва
        line += value.toFixed(1).padStart(4) + " │";

        // Точки графіку з правильним інтервалом
        hourlyData.forEach((data, index) => {
            const kp = parseFloat(data.kp);
            const normalizedKp = ((kp - minKp) / range) * chartHeight;

            if (Math.abs(normalizedKp - row) < 0.5) {
                const status = FormatUtils.getKpStatus(kp);
                if (index === 0) {
                    line += " " + status.emoji; // Додаємо пробіл перед першим емоджі
                } else if (index >= 1 && index <= 3) {
                    line += " " + status.emoji; // Пробіл перед кожним емоджі
                } else {
                    line += "  " + status.emoji; // Пробіл перед кожним емоджі
                }
            } else {
                if (index === 0) {
                    line += "  "; // Два пробіли для першої позиції
                } else if (index >= 1 && index <= 3) {
                    line += "   "; // Два пробіли для інших позицій
                } else {
                    line += "  "; // Два пробіли для інших позицій
                }
            }
        });

        chartLines.push(line);
    }

    chart += "<code>";
    chartLines.forEach((line) => {
        chart += line + "\n";
    });

    // Додаємо горизонтальну вісь
    chart += "     └";
    hourlyData.forEach((data, index) => {
        if (index === 0) {
            chart += "──";
        } else {
            chart += "────"; // Три тире для кращого вирівнювання
        }
    });
    chart += "\n";

    // Часові мітки зсунуті вліво
    chart += "      "; // Менше відступу зліва
    hourlyData.forEach((data, index) => {
        const hour = data.timeRange.split("-")[0].split(":")[0];
        const formattedHour = parseInt(hour);

        if (index === 0) {
            chart += String(formattedHour);
        } else {
            chart += "  " + String(formattedHour); // Два пробіли між числами
        }
    });
    chart += "</code>\n\n";

    // Додаємо детальну таблицю
    chart += "<b>📊 Детальні дані:</b>\n";
    hourlyData.forEach((data, index) => {
        const kp = parseFloat(data.kp);
        const status = FormatUtils.getKpStatus(kp);
        const isLast = index === hourlyData.length - 1;
        const marker = isLast ? "👉 " : "   ";

        chart += `${marker}<code>${data.timeRange}</code>: ${data.kp} ${status.emoji} ${status.status}\n`;
    });

    return chart;
}

// Обробник для кнопки "Графік 9 год"
async function handleShow9HourChart(ctx, userLocations) {
    try {
        await ctx.answerCbQuery("📈 Створюю графік...");

        const loadingMessage = await ctx.reply(
            "🔄 Генерую графік Kp-індексу..."
        );

        // Отримуємо текстовий прогноз
        const textForecast = await EnhancedNOAAService.getNoaaData(
            "/text/3-day-geomag-forecast.txt"
        );

        if (!textForecast) {
            await ctx.deleteMessage(loadingMessage.message_id);
            await ctx.reply("❌ Не вдалося отримати дані для графіку");
            return;
        }

        const parsedForecast = parseNoaaTextForecast(textForecast);

        if (!parsedForecast) {
            await ctx.deleteMessage(loadingMessage.message_id);
            await ctx.reply("❌ Не вдалося обробити дані для графіку");
            return;
        }

        // Отримуємо дані за останні 9 годин
        const last9HoursData = getLast9HoursData(parsedForecast);

        if (last9HoursData.length === 0) {
            await ctx.deleteMessage(loadingMessage.message_id);
            await ctx.reply("❌ Недостатньо даних для створення графіку");
            return;
        }

        // Створюємо графік
        const chartMessage = createKpChart(last9HoursData);

        // Додаємо інформацію про джерело та час
        const updateTime = new Date().toLocaleString("uk-UA", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Europe/Kiev",
        });

        const fullMessage =
            chartMessage +
            "\n📡 <b>Джерело:</b> NOAA SWPC (текстовий прогноз)\n" +
            `🕐 <b>Оновлено:</b> ${updateTime}\n` +
            "⏰ <b>Час:</b> київський\n\n" +
            "<i>Графік показує тенденцію зміни геомагнітної активності</i>";

        const keyboard = Markup.inlineKeyboard([
            [
                Markup.button.callback("🔄 Оновити графік", "update_chart"),
                Markup.button.callback("📊 Поточні дані", "update_current"),
            ],
            [
                Markup.button.callback("🔮 Прогноз", "show_forecast"),
                Markup.button.callback("🌌 Полярні сяйва", "show_aurora"),
            ],
        ]);

        await ctx.deleteMessage(loadingMessage.message_id);
        await ctx.reply(fullMessage, { ...keyboard, parse_mode: "HTML" });
    } catch (error) {
        log(`Помилка створення графіку: ${error.message}`);
        try {
            await ctx.deleteMessage(loadingMessage.message_id);
        } catch (deleteError) {}
        await ctx.reply("❌ Помилка створення графіку. Спробуйте пізніше.");
    }
}

module.exports = {
    getMainKeyboard,
    showCurrentConditions,
    handleForecast,
    handleAurora,
    handleAlerts,
    handleApiStatus,
    parseNoaaTextForecast,
    getCurrentKpFromTextForecast,
    getTodayFutureIntervalsFromTextForecast,
    handleShow9HourChart, // НОВА ФУНКЦІЯ
    getLast9HoursData, // НОВА ФУНКЦІЯ
    createKpChart, // НОВА ФУНКЦІЯ
    getBestAuroraTime,
    getRegionalAdvice,
    getSourceInfo,
};
