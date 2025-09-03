// Логування
const log = (message) => {
    console.log(`[${new Date().toISOString()}] ${message}`);
};

class FormatUtils {
    static getKpStatus(kp) {
        if (kp <= 2) {
            return {
                emoji: "🟢",
                status: "Спокійно",
                description: "Геомагнітна активність мінімальна",
                level: "low",
            };
        } else if (kp <= 4) {
            return {
                emoji: "🟡",
                status: "Невелика активність",
                description: "Можливі незначні порушення радіозв'язку",
                level: "minor",
            };
        } else if (kp <= 6) {
            return {
                emoji: "🟠",
                status: "Помірна геомагнітна буря",
                description: "Можливі порушення GPS та радіозв'язку",
                level: "moderate",
            };
        } else if (kp <= 8) {
            return {
                emoji: "🔴",
                status: "Сильна геомагнітна буря",
                description: "Серйозні порушення технологій, полярні сяйва",
                level: "strong",
            };
        } else {
            return {
                emoji: "🚨",
                status: "Екстремальна буря",
                description: "Критичні порушення інфраструктури!",
                level: "extreme",
            };
        }
    }

    static formatTimestamp(timestamp) {
        try {
            const date = new Date(timestamp);

            if (isNaN(date.getTime())) {
                return "Час невідомий";
            }

            return date.toLocaleString("uk-UA", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Europe/Kiev",
                timeZoneName: "short",
            });
        } catch (error) {
            log(`Помилка форматування часу: ${error.message}`);
            return "Час невідомий";
        }
    }

    static getStormProbability(kp) {
        if (kp < 5) return "Низька (<25%)";
        if (kp < 7) return "Помірна (25-50%)";
        if (kp < 8) return "Висока (50-75%)";
        return "Дуже висока (>75%)";
    }
}

module.exports = FormatUtils;
