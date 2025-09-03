const axios = require("axios");

const NOAA_BASE_URL = "https://services.swpc.noaa.gov";
const GFZ_BASE_URL = "https://kp.gfz-potsdam.de/app/json"; // Додано константу
const ISGI_BASE_URL = "https://isgi.unistra.fr/api";

// Логування
const log = (message) => {
    console.log(`[${new Date().toISOString()}] ${message}`);
};

class EnhancedNOAAService {
    // Метод для NOAA API
    static async getNoaaData(endpoint) {
        try {
            const url = `${NOAA_BASE_URL}${endpoint}`;
            log(`Запит до NOAA: ${url}`);

            const response = await axios.get(url, {
                timeout: 15000,
                headers: {
                    "User-Agent": "Legit-Weather-Bot/1.0",
                    Accept: "application/json",
                },
            });

            if (response.status !== 200) {
                log(`NOAA API поверув статус: ${response.status}`);
                return null;
            }

            if (endpoint.includes(".txt")) {
                return response.data;
            }

            if (!response.data) {
                log(`NOAA API повернув порожні дані для ${endpoint}`);
                return null;
            }

            return response.data;
        } catch (error) {
            log(`Помилка NOAA API (${endpoint}): ${error.message}`);
            return null;
        }
    }

    // Метод для GFZ Potsdam API
    static async getGfzPotsdamData(endpoint = "") {
        try {
            const url = `${GFZ_BASE_URL}${endpoint}`;
            log(`Запит до GFZ Potsdam: ${url}`);

            const response = await axios.get(url, {
                timeout: 10000,
                headers: {
                    "User-Agent": "Legit-Weather-Bot/1.0",
                },
            });

            if (response.status !== 200) {
                log(`GFZ Potsdam API поверув статус: ${response.status}`);
                return null;
            }

            return response.data;
        } catch (error) {
            log(`Помилка GFZ Potsdam API: ${error.message}`);
            return null;
        }
    }

    // Отримання Kp з NOAA
    static async getNoaaKpIndex() {
        const data = await this.getNoaaData("/json/planetary_k_index_1m.json");
        if (!data || !Array.isArray(data) || data.length === 0) {
            return null;
        }

        const latest = data[data.length - 1];
        return {
            kp: parseFloat(latest.kp_index || 0),
            timestamp: latest.time_tag || new Date().toISOString(),
            source: "noaa",
        };
    }

    // Отримання Kp з GFZ Potsdam
    static async getGfzPotsdamKp() {
        const data = await this.getGfzPotsdamData();
        if (!data || !Array.isArray(data) || data.length === 0) {
            return null;
        }

        // Шукаємо останнє значення Kp
        const latest = data[data.length - 1];

        // GFZ може мати різні формати
        let kpValue = 0;
        if (latest.Kp !== undefined) kpValue = latest.Kp;
        else if (latest.kp !== undefined) kpValue = latest.kp;
        else if (latest.kp_index !== undefined) kpValue = latest.kp_index;

        return {
            kp: parseFloat(kpValue || 0),
            timestamp:
                latest.TimeStamp || latest.time_tag || new Date().toISOString(),
            source: "gfz-potsdam",
        };
    }

    // Додати метод для ISGI (International Service of Geomagnetic Indices)
    static async getIsgiKp() {
        try {
            // ISGI має відкрите API для Kp індексу
            const url =
                "https://isgi.unistra.fr/data_download.php?type=kp&format=json&period=latest";
            log(`Запит до ISGI: ${url}`);

            const response = await axios.get(url, {
                timeout: 10000,
                headers: {
                    "User-Agent": "Legit-Weather-Bot/1.0",
                },
            });

            if (response.status === 200 && response.data) {
                // Парсимо дані ISGI
                if (Array.isArray(response.data) && response.data.length > 0) {
                    const latest = response.data[response.data.length - 1];
                    return {
                        kp: parseFloat(latest.kp || latest.Kp || 0),
                        timestamp:
                            latest.date ||
                            latest.time ||
                            new Date().toISOString(),
                        source: "isgi",
                    };
                }
            }
        } catch (error) {
            log(`Помилка ISGI API: ${error.message}`);
        }
        return null;
    }

    // Оновити getCurrentKpIndex для використання трьох джерел
    static async getCurrentKpIndex() {
        log("Отримання Kp-індексу з NOAA, GFZ та ISGI...");

        // Запускаємо запити паралельно до всіх трьох джерел
        const [noaaPromise, gfzPromise, isgiPromise] = await Promise.allSettled(
            [this.getNoaaKpIndex(), this.getGfzPotsdamKp(), this.getIsgiKp()]
        );

        let availableSources = [];

        if (noaaPromise.status === "fulfilled" && noaaPromise.value) {
            availableSources.push(noaaPromise.value);
        }
        if (gfzPromise.status === "fulfilled" && gfzPromise.value) {
            availableSources.push(gfzPromise.value);
        }
        if (isgiPromise.status === "fulfilled" && isgiPromise.value) {
            availableSources.push(isgiPromise.value);
        }

        // Логування
        log(
            `NOAA Kp: ${
                noaaPromise.status === "fulfilled" && noaaPromise.value
                    ? noaaPromise.value.kp
                    : "недоступно"
            }`
        );
        log(
            `GFZ Kp: ${
                gfzPromise.status === "fulfilled" && gfzPromise.value
                    ? gfzPromise.value.kp
                    : "недоступно"
            }`
        );
        log(
            `ISGI Kp: ${
                isgiPromise.status === "fulfilled" && isgiPromise.value
                    ? isgiPromise.value.kp
                    : "недоступно"
            }`
        );

        if (availableSources.length === 0) {
            // Жодне джерело недоступне
            log(
                "Всі джерела недоступні, використовуємо значення за замовчуванням"
            );
            return {
                kp: 0,
                timestamp: new Date().toISOString(),
                source: "fallback",
                hasBackup: false,
                availableSources: 0,
            };
        }

        // Вибираємо максимальне значення з доступних джерел
        const selectedData = availableSources.reduce((max, current) =>
            current.kp > max.kp ? current : max
        );

        // Додаємо інформацію про резервні джерела
        selectedData.availableSources = availableSources.length;
        selectedData.backupValues = availableSources
            .filter((source) => source.source !== selectedData.source)
            .map((source) => ({ source: source.source, kp: source.kp }));
        selectedData.hasBackup = availableSources.length > 1;

        log(
            `Вибрано ${selectedData.source} (${selectedData.kp}) з ${availableSources.length} доступних джерел`
        );

        return selectedData;
    }

    // Магнетометр (тільки NOAA)
    static async getMagnetometerData() {
        const data = await this.getNoaaData(
            "/json/goes/primary/magnetometers-1-day.json"
        );
        if (!data || !Array.isArray(data) || data.length === 0) {
            return null;
        }
        return data.slice(-6);
    }

    // Сонячна активність (тільки NOAA)
    static async getSolarActivity() {
        const data = await this.getNoaaData(
            "/json/goes/primary/xrays-1-day.json"
        );
        if (!data || !Array.isArray(data) || data.length === 0) {
            return null;
        }
        return data.slice(-6);
    }

    // Попередження (базується на поточному Kp)
    static async getAlerts() {
        const kpData = await this.getCurrentKpIndex();
        const alerts = [];

        if (kpData.kp >= 5) {
            alerts.push({
                message_type: "Геомагнітне попередження",
                issue_datetime: new Date().toISOString(),
                message: `Підвищена геомагнітна активність (Kp=${kpData.kp.toFixed(
                    1
                )}). Можливі порушення GPS та радіозв'язку.`,
                source: kpData.source,
            });
        }

        if (kpData.kp >= 7) {
            alerts.push({
                message_type: "Геомагнітна буря",
                issue_datetime: new Date().toISOString(),
                message: `Сильна геомагнітна буря (Kp=${kpData.kp.toFixed(
                    1
                )}). Очікуються серйозні порушення технологій та яскраві полярні сяйва.`,
                source: kpData.source,
            });
        }

        return alerts;
    }

    // Прогноз з пріоритетом NOAA
    static async getForecast() {
        log("Отримання прогнозу з NOAA...");

        const noaaForecast = await this.getNoaaForecast();

        if (noaaForecast && noaaForecast.length > 0) {
            noaaForecast.forEach((day) => (day.source = "noaa"));
            log("Використовується прогноз NOAA");
            return noaaForecast;
        } else {
            // Генеруємо простий прогноз
            const currentKp = await this.getCurrentKpIndex();
            const forecast = this.generateSimpleForecast(currentKp.kp);
            forecast.forEach((day) => (day.source = "generated"));
            log("Використовується згенерований прогноз");
            return forecast;
        }
    }

    // NOAA прогноз
    static async getNoaaForecast() {
        try {
            const textForecast = await this.getNoaaData(
                "/text/3-day-geomag-forecast.txt"
            );
            if (textForecast) {
                return this.parseTextForecast(textForecast);
            }
        } catch (error) {
            log(`Помилка отримання NOAA прогнозу: ${error.message}`);
        }
        return null;
    }

    // Парсинг текстового прогнозу NOAA
    static parseTextForecast(textData) {
        const lines = textData.split("\n");
        const forecast = [];

        try {
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                const dateMatch = line.match(/(\d{4})\s+(\w{3})\s+(\d{1,2})/);
                if (dateMatch) {
                    const year = dateMatch[1];
                    const month = dateMatch[2];
                    const day = dateMatch[3];

                    const nextLine = lines[i + 1]?.trim() || "";
                    const kpMatch = nextLine.match(/(\d\.?\d?)/g);

                    if (kpMatch && kpMatch.length > 0) {
                        const maxKp = Math.max(
                            ...kpMatch.map((k) => parseFloat(k))
                        );
                        forecast.push({
                            DateStamp: `${day} ${month} ${year}`,
                            KpMax: maxKp.toFixed(1),
                        });
                    }
                }
            }
        } catch (error) {
            log(`Помилка парсингу прогнозу: ${error.message}`);
        }

        return forecast.slice(0, 3);
    }

    // Простий згенерований прогноз
    static generateSimpleForecast(currentKp) {
        const today = new Date();
        const forecast = [];

        for (let i = 0; i < 3; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);

            const variation = (Math.random() - 0.5) * (i + 1);
            let predictedKp = Math.max(0, Math.min(9, currentKp + variation));
            predictedKp = Math.round(predictedKp * 3) / 3;

            forecast.push({
                DateStamp: date.toLocaleDateString("uk-UA", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                }),
                KpMax: predictedKp.toFixed(1),
                confidence: i === 0 ? "Висока" : i === 1 ? "Помірна" : "Низька",
            });
        }

        return forecast;
    }

    // Статус API для діагностики
    static async getApiStatus() {
        log("Перевірка статусу API...");

        const [noaaTest, gfzTest] = await Promise.allSettled([
            this.getNoaaKpIndex(),
            this.getGfzPotsdamKp(),
        ]);

        return {
            noaa: {
                available:
                    noaaTest.status === "fulfilled" && noaaTest.value !== null,
                data: noaaTest.status === "fulfilled" ? noaaTest.value : null,
                error:
                    noaaTest.status === "rejected"
                        ? noaaTest.reason.message
                        : null,
            },
            gfz: {
                available:
                    gfzTest.status === "fulfilled" && gfzTest.value !== null,
                data: gfzTest.status === "fulfilled" ? gfzTest.value : null,
                error:
                    gfzTest.status === "rejected"
                        ? gfzTest.reason.message
                        : null,
            },
        };
    }
}

module.exports = EnhancedNOAAService;
