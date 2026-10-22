package app.gripello.widget;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

// Port of openStatus in shared/utils/openingHours.ts (the iOS widget has the same in OpeningHours.swift).
final class OpeningHours {

    static final String[] WEEKDAYS = { "mon", "tue", "wed", "thu", "fri", "sat", "sun" };

    static final class Status {
        final boolean open;
        // until when open, else when it opens next ("" = no hours at all)
        final String time;
        // -1 = today, else the weekday (Monday = 0) it opens on
        final int day;

        Status(boolean open, String time, int day) {
            this.open = open;
            this.time = time;
            this.day = day;
        }
    }

    private OpeningHours() {}

    // null when the gym keeps no opening hours.
    static Status status(String json, Calendar now) {
        JSONObject hours;
        try {
            hours = json == null ? null : new JSONObject(json);
        } catch (JSONException e) {
            return null;
        }
        if (hours == null) return null;
        int index = (now.get(Calendar.DAY_OF_WEEK) + 5) % 7;
        int time = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE);
        List<String[]> today = intervals(hours, WEEKDAYS[index]);
        List<String[]> yesterday = intervals(hours, WEEKDAYS[(index + 6) % 7]);

        for (String[] interval : yesterday) {
            if (crossesMidnight(interval) && time < minutes(interval[1])) return new Status(true, interval[1], -1);
        }
        for (String[] interval : today) {
            if (minutes(interval[0]) <= time && (crossesMidnight(interval) || time < minutes(interval[1]))) {
                return new Status(true, interval[1], -1);
            }
        }
        String later = null;
        for (String[] interval : today) {
            if (minutes(interval[0]) > time && (later == null || minutes(interval[0]) < minutes(later))) later = interval[0];
        }
        if (later != null) return new Status(false, later, -1);
        for (int offset = 1; offset <= 7; offset++) {
            int day = (index + offset) % 7;
            String first = null;
            for (String[] interval : intervals(hours, WEEKDAYS[day])) {
                if (first == null || minutes(interval[0]) < minutes(first)) first = interval[0];
            }
            if (first != null) return new Status(false, first, day);
        }
        return intervals(hours, "holiday").isEmpty() ? null : new Status(false, "", -1);
    }

    private static List<String[]> intervals(JSONObject hours, String day) {
        List<String[]> result = new ArrayList<>();
        JSONArray list = hours.optJSONArray(day);
        for (int i = 0; list != null && i < list.length(); i++) {
            JSONArray interval = list.optJSONArray(i);
            if (interval != null && interval.length() == 2) result.add(new String[] { interval.optString(0), interval.optString(1) });
        }
        return result;
    }

    private static int minutes(String time) {
        try {
            return Integer.parseInt(time.substring(0, 2)) * 60 + Integer.parseInt(time.substring(3, 5));
        } catch (RuntimeException e) {
            return 0;
        }
    }

    private static boolean crossesMidnight(String[] interval) {
        return minutes(interval[1]) < minutes(interval[0]);
    }
}
