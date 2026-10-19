package app.gripello.widget;

import android.content.Context;
import android.net.Uri;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

// Same requests as the iOS widget (mobile/ios/App/GripelloWidget/WidgetAPI.swift).
final class WidgetData {

    static final class Send {
        final String name;
        final String grade;
        final String color;
        final boolean flash;

        Send(String name, String grade, String color, boolean flash) {
            this.name = name;
            this.grade = grade;
            this.color = color;
            this.flash = flash;
        }
    }

    static final class Stats {
        int sends;
        int flashes;
        Send hardest;
        final List<Send> latest = new ArrayList<>();
        int streak;
        int unread;
        String origin;

        String toJson() {
            try {
                JSONObject json = new JSONObject().put("sends", sends).put("flashes", flashes).put("streak", streak).put("unread", unread).put("origin", origin);
                if (hardest != null) json.put("hardest", send(hardest));
                JSONArray items = new JSONArray();
                for (Send send : latest) items.put(send(send));
                return json.put("latest", items).toString();
            } catch (JSONException e) {
                return null;
            }
        }

        static Stats fromJson(String raw) {
            try {
                JSONObject json = new JSONObject(raw);
                Stats stats = new Stats();
                stats.sends = json.optInt("sends");
                stats.flashes = json.optInt("flashes");
                stats.streak = json.optInt("streak");
                stats.unread = json.optInt("unread");
                stats.origin = json.optString("origin", DEFAULT_ORIGIN);
                if (json.has("hardest")) stats.hardest = send(json.getJSONObject("hardest"));
                JSONArray items = json.optJSONArray("latest");
                for (int i = 0; items != null && i < items.length(); i++) stats.latest.add(send(items.getJSONObject(i)));
                return stats;
            } catch (JSONException e) {
                return null;
            }
        }

        private static JSONObject send(Send send) throws JSONException {
            return new JSONObject().put("name", send.name).put("grade", send.grade).put("color", send.color).put("flash", send.flash);
        }

        private static Send send(JSONObject json) {
            return new Send(json.optString("name"), json.optString("grade"), json.optString("color", "#9E9E9E"), json.optBoolean("flash"));
        }
    }

    static final String DEFAULT_ORIGIN = "https://gripello.app";
    private static final int TIMEOUT_MS = 8000;

    private static final class Unauthorized extends IOException {}

    private WidgetData() {}

    // null = signed out; offline keeps each widget's last good numbers.
    static Map<Integer, Stats> load(Context context, int[] widgetIds) {
        Map<Integer, Stats> result = new HashMap<>();
        WidgetStore.Session session = WidgetStore.loadSession(context);
        if (session == null) {
            for (int id : widgetIds) result.put(id, null);
            return result;
        }
        try {
            session = refreshed(context, session);
            Map<String, Stats> weeks = new HashMap<>();
            int streak = -1;
            int unread = 0;
            for (int id : widgetIds) {
                String gym = WidgetStore.gymId(context, id);
                String key = gym == null ? "" : gym;
                if (!weeks.containsKey(key)) {
                    Stats week = week(session, gym);
                    if (week != null && streak < 0) {
                        streak = streak(session);
                        unread = unread(session);
                    }
                    if (week != null) {
                        week.streak = streak;
                        week.unread = unread;
                    }
                    weeks.put(key, week);
                }
                Stats stats = weeks.get(key);
                if (stats == null) {
                    result.put(id, cachedOrEmpty(context, id, session.origin));
                    continue;
                }
                String json = stats.toJson();
                if (json != null) WidgetStore.saveSnapshotIf(context, id, json, session.token, gym);
                result.put(id, stats);
            }
        } catch (Unauthorized e) {
            // A revoked or expired session: the app signs the widget in again on its next start.
            WidgetStore.clearSessionIf(context, session.token);
            for (int id : widgetIds) result.put(id, null);
        } catch (IOException e) {
            for (int id : widgetIds) result.put(id, cachedOrEmpty(context, id, session.origin));
        }
        return result;
    }

    // The widget's last good numbers, or null before its first load.
    static Stats cached(Context context, int widgetId) {
        String json = WidgetStore.snapshot(context, widgetId);
        return json == null ? null : Stats.fromJson(json);
    }

    private static Stats cachedOrEmpty(Context context, int widgetId, String origin) {
        Stats stats = cached(context, widgetId);
        if (stats != null) return stats;
        stats = new Stats();
        stats.origin = origin;
        return stats;
    }

    // The week's sends at one gym (all gyms without one); null when the network or server fails.
    private static Stats week(WidgetStore.Session session, String gym) throws Unauthorized {
        Uri.Builder ticks = Uri.parse(session.origin + "/api/me/ticks").buildUpon()
            .appendQueryParameter("since", weekStart())
            .appendQueryParameter("limit", "1000");
        if (gym != null) ticks.appendQueryParameter("gym", gym);
        try {
            Stats stats = summarize(new JSONObject(get(session, ticks.build().toString())).getJSONArray("items"));
            stats.origin = session.origin;
            return stats;
        } catch (Unauthorized e) {
            throw e;
        } catch (IOException | JSONException e) {
            return null;
        }
    }

    // Gyms for the picker; the session also lists the hidden gyms its climber belongs to.
    static JSONArray gyms(Context context) throws IOException, JSONException {
        WidgetStore.Session session = WidgetStore.loadSession(context);
        String origin = session != null ? session.origin : DEFAULT_ORIGIN;
        return new JSONObject(get(session, origin + "/api/gyms")).getJSONArray("items");
    }

    // Monday 00:00 on the phone's clock, sent as an instant so the server needs no timezone.
    static String weekStart() {
        Calendar week = Calendar.getInstance();
        week.setFirstDayOfWeek(Calendar.MONDAY);
        week.set(Calendar.HOUR_OF_DAY, 0);
        week.set(Calendar.MINUTE, 0);
        week.set(Calendar.SECOND, 0);
        week.set(Calendar.MILLISECOND, 0);
        week.set(Calendar.DAY_OF_WEEK, Calendar.MONDAY);
        if (week.after(Calendar.getInstance())) week.add(Calendar.WEEK_OF_YEAR, -1);
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(week.getTime());
    }

    // Boulder and route grades share no axis, so the hardest comes from the week's most climbed grade system.
    private static Stats summarize(JSONArray items) throws JSONException {
        Stats stats = new Stats();
        List<JSONObject> ticks = new ArrayList<>();
        List<Send> sends = new ArrayList<>();
        // Insertion order = newest first, so a tie goes to the system of the most recent send (as on iOS).
        Map<String, Integer> systems = new LinkedHashMap<>();
        for (int i = 0; i < items.length(); i++) {
            JSONObject tick = items.getJSONObject(i);
            String type = tick.optString("type");
            if (type.equals("attempt")) continue;
            systems.merge(tick.optString("grade_system"), 1, Integer::sum);
            JSONObject expand = tick.optJSONObject("expand");
            JSONObject route = expand == null ? null : expand.optJSONObject("route");
            Send send = new Send(
                tick.optString("route_name"),
                tick.optString("grade"),
                route == null ? "#9E9E9E" : route.optString("color", "#9E9E9E"),
                type.equals("flash")
            );
            ticks.add(tick);
            sends.add(send);
            stats.sends++;
            if (send.flash) stats.flashes++;
            if (stats.latest.size() < 3) stats.latest.add(send);
        }
        String system = null;
        for (Map.Entry<String, Integer> entry : systems.entrySet()) {
            if (system == null || entry.getValue() > systems.get(system)) system = entry.getKey();
        }
        double hardest = -1;
        for (int i = 0; i < ticks.size(); i++) {
            double index = ticks.get(i).optDouble("grade_index", 0);
            if (!ticks.get(i).optString("grade_system").equals(system) || index <= hardest) continue;
            hardest = index;
            stats.hardest = sends.get(i);
        }
        return stats;
    }

    private static int streak(WidgetStore.Session session) {
        try {
            JSONArray achievements = new JSONArray(get(session, session.origin + "/api/climbers/" + Uri.encode(session.userId) + "/achievements"));
            for (int i = 0; i < achievements.length(); i++) {
                JSONObject achievement = achievements.getJSONObject(i);
                if ("active_weeks".equals(achievement.optString("key"))) return achievement.optInt("current");
            }
        } catch (IOException | JSONException ignored) {
            // The streak is extra; the week's sends still show.
        }
        return 0;
    }

    private static int unread(WidgetStore.Session session) {
        try {
            return new JSONObject(get(session, session.origin + "/api/me/notifications?unread=true&limit=1")).optInt("total");
        } catch (IOException | JSONException ignored) {
            return 0;
        }
    }

    // Same rule as the web app (app/utils/session.ts): renew once less than 6 days are left.
    private static WidgetStore.Session refreshed(Context context, WidgetStore.Session session) throws IOException {
        long exp = expiry(session.token);
        if (exp == 0 || exp * 1000 - System.currentTimeMillis() > 6L * 24 * 3600 * 1000) return session;
        try {
            String body = request(session, session.origin + "/api/auth/refresh", "POST");
            String token = new JSONObject(body).optString("token", null);
            if (token == null || token.isEmpty()) return session;
            WidgetStore.Session next = new WidgetStore.Session(token, session.userId, session.origin);
            WidgetStore.replaceSessionIf(context, session.token, next);
            return next;
        } catch (JSONException e) {
            return session;
        }
    }

    private static long expiry(String token) {
        String[] parts = token.split("\\.");
        if (parts.length != 3) return 0;
        try {
            String payload = new String(Base64.decode(parts[1], Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP), StandardCharsets.UTF_8);
            return new JSONObject(payload).optLong("exp");
        } catch (IllegalArgumentException | JSONException e) {
            return 0;
        }
    }

    private static String get(WidgetStore.Session session, String url) throws IOException {
        return request(session, url, "GET");
    }

    private static String request(WidgetStore.Session session, String url, String method) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        try {
            connection.setRequestMethod(method);
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setRequestProperty("Accept", "application/json");
            if (session != null) connection.setRequestProperty("Authorization", "Bearer " + session.token);
            int status = connection.getResponseCode();
            if (status == 401) throw new Unauthorized();
            if (status < 200 || status >= 300) throw new IOException("HTTP " + status);
            try (InputStream in = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                for (int read; (read = in.read(buffer)) != -1; ) out.write(buffer, 0, read);
                return out.toString(StandardCharsets.UTF_8.name());
            }
        } finally {
            connection.disconnect();
        }
    }
}
