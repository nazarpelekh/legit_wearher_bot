const axios = require("axios");

const NOAA_BASE_URL = "https://services.swpc.noaa.gov";

// Логування
const log = (message) => {
    console.log(`[${new Date().toISOString()}] ${message}`);
};

class NOAAService {
    static async getData(endpoint) {
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
            if (error.response) {
                log(
                    `Статус помилки: ${
                        error.response.status
                    }, Дані: ${JSON.stringify(error.response.data)}`
                );
            }
            return null;
        }
    }

    static async getCurrentKpIndex() {
        const data = await this.getData("/json/planetary_k_index_1m.json");
        if (!data || !Array.isArray(data) || data.length === 0) {
            return { kp: 0, timestamp: new Date().toISOString() };
        }

        const latest = data[data.length - 1];
        const timestamp = latest.time_tag || new Date().toISOString();

        log(`Отримано Kp дані: ${latest.kp_index}, час: ${timestamp}`);

        log(`=== ДЕТАЛЬНА ПЕРЕВІРКА KP ===`);
        log(`NOAA відповідь: ${JSON.stringify(noaaPromise.value)}`);
        log(`GFZ відповідь: ${JSON.stringify(gfzPromise.value)}`);

        return {
            kp: parseFloat(latest.kp_index || 0),
            timestamp: timestamp,
        };
    }

    static async getMagnetometerData() {
        const data = await this.getData(
            "/json/goes/primary/magnetometers-1-day.json"
        );
        if (!data || !Array.isArray(data) || data.length === 0) {
            return null;
        }
        return data.slice(-6);
    }

    static async getSolarActivity() {
        const data = await this.getData("/json/goes/primary/xrays-1-day.json");
        if (!data || !Array.isArray(data) || data.length === 0) {
            return null;
        }
        return data.slice(-6);
    }

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
            });
        }

        if (kpData.kp >= 7) {
            alerts.push({
                message_type: "Геомагнітна буря",
                issue_datetime: new Date().toISOString(),
                message: `Сильна геомагнітна буря (Kp=${kpData.kp.toFixed(
                    1
                )}). Очікуються серйозні порушення технологій та яскраві полярні сяйва.`,
            });
        }

        return alerts;
    }

    static async getForecast() {
        try {
            const textForecast = await this.getData(
                "/text/3-day-geomag-forecast.txt"
            );
            if (textForecast) {
                return this.parseTextForecast(textForecast);
            }
        } catch (error) {
            log(`Помилка отримання текстового прогнозу: ${error.message}`);
        }

        const currentKp = await this.getCurrentKpIndex();
        return this.generateSimpleForecast(currentKp.kp);
    }

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
}

module.exports = NOAAService;
