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
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

// Same requests as the iOS widgets (mobile/ios/App/GripelloWidget/WidgetAPI.swift).
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

    // "My climbing": the week's sends, Monday first in days.
    static final class Stats {
        int sends;
        int flashes;
        Send hardest;
        final int[] days = new int[7];
        int streak;
        boolean streakRisk;
        int rank;
        int rankMove;
        String rankWeek;
        int rankBase;
        String lastClimb;
        String origin;

        String toJson() {
            try {
                JSONObject json = new JSONObject().put("sends", sends).put("flashes", flashes).put("streak", streak)
                    .put("streakRisk", streakRisk).put("rank", rank).put("rankMove", rankMove).put("rankBase", rankBase).put("origin", origin);
                if (rankWeek != null) json.put("rankWeek", rankWeek);
                if (lastClimb != null) json.put("lastClimb", lastClimb);
                if (hardest != null) json.put("hardest", send(hardest));
                JSONArray week = new JSONArray();
                for (int count : days) week.put(count);
                return json.put("days", week).toString();
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
                stats.streakRisk = json.optBoolean("streakRisk");
                stats.rank = json.optInt("rank");
                stats.rankMove = json.optInt("rankMove");
                stats.rankBase = json.optInt("rankBase");
                stats.rankWeek = json.optString("rankWeek", null);
                stats.lastClimb = json.optString("lastClimb", null);
                stats.origin = json.optString("origin", DEFAULT_ORIGIN);
                if (json.has("hardest")) stats.hardest = send(json.getJSONObject("hardest"));
                JSONArray week = json.optJSONArray("days");
                for (int i = 0; week != null && i < 7 && i < week.length(); i++) stats.days[i] = week.optInt(i);
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

    static final class NewRoute {
        final String name;
        final String grade;
        final String color;
        final String wall;
        final String created;

        NewRoute(String name, String grade, String color, String wall, String created) {
            this.name = name;
            this.grade = grade;
            this.color = color;
            this.wall = wall;
            this.created = created;
        }
    }

    // "My gym": opening hours (the status is worked out when drawing), the week's new routes and the next planned reset.
    static final class GymStats {
        String hours;
        int newCount;
        boolean followed;
        final List<NewRoute> routes = new ArrayList<>();
        final List<String> colors = new ArrayList<>();
        String resetWall;
        int resetMoreWalls;
        String resetDate;
        NewRoute lastNew;
        String origin;
        String slug;

        String toJson() {
            try {
                JSONObject json = new JSONObject().put("newCount", newCount).put("followed", followed)
                    .put("resetMoreWalls", resetMoreWalls).put("origin", origin);
                if (hours != null) json.put("hours", hours);
                if (slug != null) json.put("slug", slug);
                if (resetWall != null) json.put("resetWall", resetWall).put("resetDate", resetDate);
                if (lastNew != null) json.put("lastNew", route(lastNew));
                JSONArray items = new JSONArray();
                for (NewRoute route : routes) items.put(route(route));
                JSONArray holds = new JSONArray();
                for (String color : colors) holds.put(color);
                return json.put("routes", items).put("colors", holds).toString();
            } catch (JSONException e) {
                return null;
            }
        }

        static GymStats fromJson(String raw) {
            try {
                JSONObject json = new JSONObject(raw);
                GymStats stats = new GymStats();
                stats.hours = json.optString("hours", null);
                stats.slug = json.optString("slug", null);
                stats.newCount = json.optInt("newCount");
                stats.followed = json.optBoolean("followed");
                stats.resetWall = json.optString("resetWall", null);
                stats.resetDate = json.optString("resetDate", null);
                stats.resetMoreWalls = json.optInt("resetMoreWalls");
                stats.origin = json.optString("origin", DEFAULT_ORIGIN);
                if (json.has("lastNew")) stats.lastNew = route(json.getJSONObject("lastNew"));
                JSONArray items = json.optJSONArray("routes");
                for (int i = 0; items != null && i < items.length(); i++) stats.routes.add(route(items.getJSONObject(i)));
                JSONArray holds = json.optJSONArray("colors");
                for (int i = 0; holds != null && i < holds.length(); i++) stats.colors.add(holds.optString(i));
                return stats;
            } catch (JSONException e) {
                return null;
            }
        }

        private static JSONObject route(NewRoute route) throws JSONException {
            return new JSONObject().put("name", route.name).put("grade", route.grade).put("color", route.color)
                .put("wall", route.wall).put("created", route.created);
        }

        private static NewRoute route(JSONObject json) {
            return new NewRoute(json.optString("name"), json.optString("grade"), json.optString("color", "#9E9E9E"),
                json.optString("wall"), json.optString("created"));
        }
    }

    static final String DEFAULT_ORIGIN = "https://gripello.app";
    private static final int TIMEOUT_MS = 8000;
    private static final int GYM_ROUTE_ROWS = 3;
    private static final int GYM_HOLD_DOTS = 7;

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
            boolean streakRisk = false;
            for (int id : widgetIds) {
                String gym = WidgetStore.gymId(context, id);
                String key = gym == null ? "" : gym;
                if (!weeks.containsKey(key)) {
                    Stats week = week(session, gym);
                    if (week != null) {
                        if (streak < 0) {
                            streak = streak(session);
                            streakRisk = streak > 0 && streakAtRisk(lastClimb(session, null));
                        }
                        week.streak = streak;
                        week.streakRisk = streakRisk;
                        if (week.sends == 0) week.lastClimb = lastClimb(session, gym);
                        if (gym != null) week.rank = rank(session, gym);
                    }
                    weeks.put(key, week);
                }
                Stats stats = weeks.get(key);
                if (stats == null) {
                    result.put(id, cachedOrEmpty(context, id, session.origin));
                    continue;
                }
                Stats drawn = withRankMove(stats, cached(context, id));
                String json = drawn.toJson();
                if (json != null) WidgetStore.saveSnapshotIf(context, id, json, session.token, gym);
                result.put(id, drawn);
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

    // The gym widgets; a widget without a gym (picker skipped) gets an empty card. null = signed out.
    static Map<Integer, GymStats> loadGyms(Context context, int[] widgetIds) {
        Map<Integer, GymStats> result = new HashMap<>();
        WidgetStore.Session session = WidgetStore.loadSession(context);
        if (session == null) {
            for (int id : widgetIds) result.put(id, null);
            return result;
        }
        try {
            session = refreshed(context, session);
            Map<String, GymStats> gyms = new HashMap<>();
            Set<String> followed = null;
            for (int id : widgetIds) {
                String gym = WidgetStore.gymId(context, id);
                if (gym == null) {
                    GymStats empty = new GymStats();
                    empty.origin = session.origin;
                    result.put(id, empty);
                    continue;
                }
                if (!gyms.containsKey(gym)) {
                    if (followed == null) followed = followedWalls(session);
                    gyms.put(gym, gym(session, gym, followed));
                }
                GymStats stats = gyms.get(gym);
                if (stats == null) {
                    result.put(id, cachedGymOrEmpty(context, id, session.origin));
                    continue;
                }
                String json = stats.toJson();
                if (json != null) WidgetStore.saveSnapshotIf(context, id, json, session.token, gym);
                result.put(id, stats);
            }
        } catch (Unauthorized e) {
            WidgetStore.clearSessionIf(context, session.token);
            for (int id : widgetIds) result.put(id, null);
        } catch (IOException e) {
            for (int id : widgetIds) result.put(id, cachedGymOrEmpty(context, id, session.origin));
        }
        return result;
    }

    // The widget's last good numbers, or null before its first load.
    static Stats cached(Context context, int widgetId) {
        String json = WidgetStore.snapshot(context, widgetId);
        return json == null ? null : Stats.fromJson(json);
    }

    static GymStats cachedGym(Context context, int widgetId) {
        String json = WidgetStore.snapshot(context, widgetId);
        return json == null ? null : GymStats.fromJson(json);
    }

    private static Stats cachedOrEmpty(Context context, int widgetId, String origin) {
        Stats stats = cached(context, widgetId);
        if (stats != null) return stats;
        stats = new Stats();
        stats.origin = origin;
        return stats;
    }

    private static GymStats cachedGymOrEmpty(Context context, int widgetId, String origin) {
        GymStats stats = cachedGym(context, widgetId);
        if (stats != null) return stats;
        stats = new GymStats();
        stats.origin = origin;
        return stats;
    }

    // The rank's movement since this widget first saw it this week (the API keeps no rank history).
    static Stats withRankMove(Stats shared, Stats previous) {
        // Widgets on one gym share the loaded week; each keeps its own rank base.
        Stats fresh = Stats.fromJson(shared.toJson());
        String week = weekStart();
        boolean sameWeek = previous != null && week.equals(previous.rankWeek) && previous.rankBase > 0;
        fresh.rankWeek = week;
        fresh.rankBase = sameWeek ? previous.rankBase : fresh.rank;
        fresh.rankMove = fresh.rank > 0 && fresh.rankBase > 0 ? fresh.rankBase - fresh.rank : 0;
        return fresh;
    }

    // The week's sends at one gym (all gyms without one); null when the network or server fails.
    private static Stats week(WidgetStore.Session session, String gym) throws Unauthorized {
        Uri.Builder ticks = Uri.parse(session.origin + "/api/me/ticks").buildUpon()
            .appendQueryParameter("since", weekStartDay())
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
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return weekStart(format);
    }

    private static String weekStart(SimpleDateFormat format) {
        return format.format(monday().getTime());
    }

    private static Calendar monday() {
        Calendar week = Calendar.getInstance();
        week.setFirstDayOfWeek(Calendar.MONDAY);
        week.set(Calendar.HOUR_OF_DAY, 0);
        week.set(Calendar.MINUTE, 0);
        week.set(Calendar.SECOND, 0);
        week.set(Calendar.MILLISECOND, 0);
        week.set(Calendar.DAY_OF_WEEK, Calendar.MONDAY);
        if (week.after(Calendar.getInstance())) week.add(Calendar.WEEK_OF_YEAR, -1);
        return week;
    }

    // Ticks carry a plain day and the API reads a timestamp as its UTC day, so the week starts at the local Monday's date.
    static String weekStartDay() {
        return weekStart(new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT));
    }

    // active_weeks forgives one empty week (any tick at any gym counts), so the streak only ends this Sunday after an empty last week.
    static boolean streakAtRisk(String newestTickDay) {
        Calendar lastWeek = monday();
        lastWeek.add(Calendar.WEEK_OF_YEAR, -1);
        String lastMonday = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(lastWeek.getTime());
        return newestTickDay == null || newestTickDay.compareTo(lastMonday) < 0;
    }

    // Monday = 0; a tick's date is a plain day on the climber's calendar.
    static int weekday(String day) {
        try {
            Date date = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).parse(day);
            if (date == null) return -1;
            Calendar calendar = Calendar.getInstance();
            calendar.setTime(date);
            return (calendar.get(Calendar.DAY_OF_WEEK) + 5) % 7;
        } catch (ParseException e) {
            return -1;
        }
    }

    // Boulder and route grades share no axis, so the hardest comes from the week's most climbed grade system.
    static Stats summarize(JSONArray items) throws JSONException {
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
            int day = weekday(tick.optString("date"));
            if (day >= 0) stats.days[day]++;
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

    private static int streak(WidgetStore.Session session) throws Unauthorized {
        try {
            JSONArray achievements = new JSONArray(get(session, session.origin + "/api/climbers/" + Uri.encode(session.userId) + "/achievements"));
            for (int i = 0; i < achievements.length(); i++) {
                JSONObject achievement = achievements.getJSONObject(i);
                if ("active_weeks".equals(achievement.optString("key"))) return achievement.optInt("current");
            }
        } catch (Unauthorized e) {
            throw e;
        } catch (IOException | JSONException ignored) {
            // The streak is extra; the week's sends still show.
        }
        return 0;
    }

    // The day of the newest tick (attempts count as climbing), for the "last climb" card of an empty week.
    private static String lastClimb(WidgetStore.Session session, String gym) throws Unauthorized {
        Uri.Builder ticks = Uri.parse(session.origin + "/api/me/ticks").buildUpon().appendQueryParameter("limit", "1");
        if (gym != null) ticks.appendQueryParameter("gym", gym);
        try {
            JSONArray items = new JSONObject(get(session, ticks.build().toString())).getJSONArray("items");
            return items.length() == 0 ? null : items.getJSONObject(0).optString("date", null);
        } catch (Unauthorized e) {
            throw e;
        } catch (IOException | JSONException e) {
            return null;
        }
    }

    // The rank on the board the gym page opens first: the running season (else the last 60 days), boulders before routes.
    private static int rank(WidgetStore.Session session, String gym) throws Unauthorized {
        String base = session.origin + "/api/gyms/" + Uri.encode(gym);
        try {
            String season = runningSeason(new JSONArray(get(session, base + "/seasons")));
            for (String kind : new String[] { "boulder", "route" }) {
                Uri.Builder board = Uri.parse(base + "/leaderboard").buildUpon().appendQueryParameter("kind", kind);
                if (season != null) board.appendQueryParameter("season", season);
                JSONObject me = new JSONObject(get(session, board.build().toString())).optJSONObject("me");
                if (me != null) return me.optInt("rank");
            }
        } catch (Unauthorized e) {
            throw e;
        } catch (IOException | JSONException ignored) {
            // The rank is extra.
        }
        return 0;
    }

    static String runningSeason(JSONArray seasons) {
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date());
        for (int i = 0; i < seasons.length(); i++) {
            JSONObject season = seasons.optJSONObject(i);
            if (season == null) continue;
            if (season.optString("starts_at").compareTo(today) <= 0 && season.optString("ends_at").compareTo(today) >= 0) {
                return season.optString("id");
            }
        }
        return null;
    }

    private static Set<String> followedWalls(WidgetStore.Session session) throws Unauthorized {
        Set<String> walls = new HashSet<>();
        try {
            JSONArray followed = new JSONObject(get(session, session.origin + "/api/me")).optJSONArray("followed_walls");
            for (int i = 0; followed != null && i < followed.length(); i++) walls.add(followed.optString(i));
        } catch (Unauthorized e) {
            throw e;
        } catch (IOException | JSONException ignored) {
            // Without the followed walls the newest routes of the whole gym show.
        }
        return walls;
    }

    // null when the network or server fails, so the last good card stays.
    private static GymStats gym(WidgetStore.Session session, String gym, Set<String> followed) throws Unauthorized {
        String base = session.origin + "/api/gyms/" + Uri.encode(gym);
        try {
            GymStats stats = new GymStats();
            stats.origin = session.origin;
            JSONObject info = new JSONObject(get(session, base));
            stats.slug = info.optString("slug", null);
            JSONObject hours = info.optJSONObject("opening_hours");
            if (hours != null) stats.hours = hours.toString();

            String created = Uri.parse(base + "/routes").buildUpon()
                .appendQueryParameter("since", weekStart())
                .appendQueryParameter("include", "wall")
                .appendQueryParameter("limit", "100")
                .appendQueryParameter("total", "true")
                .build().toString();
            JSONObject page = new JSONObject(get(session, created));
            JSONArray items = page.getJSONArray("items");
            stats.newCount = page.optInt("total", items.length());
            summarizeNew(stats, items, followed);

            String planned = Uri.parse(base + "/routes").buildUpon()
                .appendQueryParameter("removal", "planned")
                .appendQueryParameter("sort", "removal_planned_for")
                .appendQueryParameter("include", "wall")
                .appendQueryParameter("limit", "1000")
                .build().toString();
            try {
                nextReset(stats, new JSONObject(get(session, planned)).getJSONArray("items"));
            } catch (Unauthorized e) {
                throw e;
            } catch (IOException | JSONException ignored) {
                // The reset is extra; the new routes still show.
            }

            if (stats.newCount == 0) {
                try {
                    JSONArray newest = new JSONObject(get(session, base + "/routes?limit=1&include=wall")).getJSONArray("items");
                    if (newest.length() > 0) stats.lastNew = newRoute(newest.getJSONObject(0));
                } catch (Unauthorized e) {
                    throw e;
                } catch (IOException | JSONException ignored) {
                    // The last new route is extra; the rest of the card still shows.
                }
            }
            return stats;
        } catch (Unauthorized e) {
            throw e;
        } catch (IOException | JSONException e) {
            return null;
        }
    }

    // Newest first; routes on followed walls lead, the rest of the gym fills up.
    static void summarizeNew(GymStats stats, JSONArray items, Set<String> followed) throws JSONException {
        List<NewRoute> onFollowed = new ArrayList<>();
        List<NewRoute> others = new ArrayList<>();
        for (int i = 0; i < items.length(); i++) {
            JSONObject route = items.getJSONObject(i);
            NewRoute row = newRoute(route);
            if (stats.colors.size() < GYM_HOLD_DOTS) stats.colors.add(row.color);
            (followed.contains(route.optString("wall")) ? onFollowed : others).add(row);
        }
        stats.followed = !onFollowed.isEmpty();
        for (List<NewRoute> group : Arrays.asList(onFollowed, others)) {
            for (NewRoute row : group) {
                if (stats.routes.size() < GYM_ROUTE_ROWS) stats.routes.add(row);
            }
        }
    }

    // The earliest planned strip date from today on and the walls coming down that day.
    static void nextReset(GymStats stats, JSONArray items) throws JSONException {
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date());
        Set<String> walls = new LinkedHashSet<>();
        for (int i = 0; i < items.length(); i++) {
            JSONObject route = items.getJSONObject(i);
            String date = route.optString("removal_planned_for", "");
            if (date.compareTo(today) < 0) continue;
            if (stats.resetDate == null) stats.resetDate = date;
            if (!date.equals(stats.resetDate)) break;
            walls.add(wallName(route));
        }
        if (stats.resetDate == null) return;
        List<String> names = new ArrayList<>(walls);
        stats.resetWall = names.isEmpty() ? "" : names.get(0);
        stats.resetMoreWalls = Math.max(0, names.size() - 1);
    }

    private static NewRoute newRoute(JSONObject route) {
        return new NewRoute(route.optString("name"), route.optString("grade"), route.optString("color", "#9E9E9E"),
            wallName(route), route.optString("created"));
    }

    private static String wallName(JSONObject route) {
        JSONObject expand = route.optJSONObject("expand");
        JSONObject wall = expand == null ? null : expand.optJSONObject("wall");
        return wall == null ? "" : wall.optString("name");
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
