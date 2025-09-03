const axios = require("axios");

// Логування
const log = (message) => {
    console.log(`[${new Date().toISOString()}] ${message}`);
};

class GeoService {
    static async getLocationName(lat, lon, geocodingApiKey = "") {
        if (
            !geocodingApiKey ||
            geocodingApiKey === "your_opencage_api_key_here"
        ) {
            // Простий геокодінг без API
            let locationName = "";

            // Визначаємо країну по координатах (спрощено)
            if (lat >= 44 && lat <= 53 && lon >= 22 && lon <= 41) {
                locationName = "Україна";

                // Визначаємо регіон
                if (lat >= 49 && lat <= 51 && lon >= 23 && lon <= 26) {
                    locationName = "Львівська область, Україна";
                } else if (
                    lat >= 50.3 &&
                    lat <= 50.6 &&
                    lon >= 30.2 &&
                    lon <= 30.8
                ) {
                    locationName = "Київ, Україна";
                } else if (
                    lat >= 46.3 &&
                    lat <= 46.6 &&
                    lon >= 30.6 &&
                    lon <= 31.0
                ) {
                    locationName = "Одеса, Україна";
                } else if (
                    lat >= 49.9 &&
                    lat <= 50.1 &&
                    lon >= 36.1 &&
                    lon <= 36.4
                ) {
                    locationName = "Харків, Україна";
                }
            } else if (lat >= 55 && lat <= 71 && lon >= 37 && lon <= 180) {
                locationName = "Росія";
            } else if (lat >= 49 && lat <= 56 && lon >= 14 && lon <= 25) {
                locationName = "Польща";
            }

            return locationName || `📍 ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
        }

        try {
            const response = await axios.get(
                "https://api.opencagedata.com/geocode/v1/json",
                {
                    params: {
                        q: `${lat},${lon}`,
                        key: geocodingApiKey,
                        language: "uk",
                        limit: 1,
                    },
                }
            );

            if (response.data.results && response.data.results.length > 0) {
                const result = response.data.results[0];
                const components = result.components;

                let locationName = "";
                if (components.city) locationName += components.city;
                else if (components.town) locationName += components.town;
                else if (components.village) locationName += components.village;

                if (components.state) locationName += `, ${components.state}`;
                if (components.country)
                    locationName += `, ${components.country}`;

                return locationName || result.formatted;
            }
        } catch (error) {
            log(`Помилка геокодування: ${error.message}`);
        }

        return `📍 ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
    }

    // Розрахунок магнітної широти (спрощений)
    static getMagneticLatitude(lat, lon) {
        const magPoleLatitude = 86.5;
        const magPoleLongitude = -164.04;

        const latRad = (lat * Math.PI) / 180;
        const lonRad = (lon * Math.PI) / 180;
        const magPoleLatRad = (magPoleLatitude * Math.PI) / 180;
        const magPoleLonRad = (magPoleLongitude * Math.PI) / 180;

        const cosMLat =
            Math.sin(magPoleLatRad) * Math.sin(latRad) + // ВИПРАВЛЕНО: Math.sin замість Math.Sin
            Math.cos(magPoleLatRad) *
                Math.cos(latRad) *
                Math.cos(lonRad - magPoleLonRad);

        const magneticLatitude = (Math.asin(cosMLat) * 180) / Math.PI;
        return magneticLatitude;
    }

    // Визначення, чи можна побачити полярні сяйва
    static canSeeAurora(lat, lon, kp) {
        const magneticLatitude = Math.abs(this.getMagneticLatitude(lat, lon));
        const auroralOvalBoundary = 67 - 2 * kp;
        return magneticLatitude >= auroralOvalBoundary;
    }

    // Отримати поради по регіону
    static getRegionalAdvice(lat, lon, kpLevel, kpValue) {
        const isHighLatitude = Math.abs(lat) > 60;
        const isMidLatitude = Math.abs(lat) > 45 && Math.abs(lat) <= 60;
        const magneticLat = this.getMagneticLatitude(lat, lon);
        const canSeeAurora = this.canSeeAurora(lat, lon, kpValue);

        let advice = "";

        switch (kpLevel) {
            case "low":
                advice = "✅ Всі системи працюють нормально\n";
                if (isHighLatitude && canSeeAurora) {
                    advice += "🌌 Можливі слабкі полярні сяйва на горизонті";
                }
                break;

            case "minor":
                advice = "📡 Можливі незначні проблеми з GPS\n";
                if (canSeeAurora) {
                    advice += "🌌 Шанс побачити полярні сяйва: помірний";
                } else if (isHighLatitude) {
                    advice += "🔍 Дивіться на північ - можливі слабкі сяйва";
                }
                break;

            case "moderate":
                advice = "📡 Рекомендується перевірити GPS точність\n";
                if (canSeeAurora) {
                    advice += "🌌 Хороший шанс побачити полярні сяйва!";
                } else if (isMidLatitude) {
                    advice +=
                        "🔍 Дивіться на північ - можливі сяйва на горизонті";
                }
                break;

            case "strong":
                advice = "⚠️ Можливі серйозні порушення навігації та зв'язку\n";
                if (canSeeAurora || isMidLatitude) {
                    advice += "🌌 Високий шанс яскравих полярних сяйв!";
                } else {
                    advice += "🔍 Навіть на низьких широтах можливі сяйва";
                }
                break;

            case "extreme":
                advice =
                    "🚨 Критична ситуація! Можливі відключення електроенергії\n";
                advice +=
                    "🌌 Полярні сяйва можуть бути видимі навіть на екваторі!";
                break;

            default:
                advice = "";
        }

        advice += `\n📍 Магнітна широта: ${magneticLat.toFixed(1)}°`;
        return advice;
    }
}

module.exports = GeoService;
