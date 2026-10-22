package app.gripello.widget;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class WidgetDataTest {

    private static String daysFromToday(int days) {
        Calendar calendar = Calendar.getInstance();
        calendar.add(Calendar.DAY_OF_MONTH, days);
        return new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(calendar.getTime());
    }

    private static int todayIndex() {
        return (Calendar.getInstance().get(Calendar.DAY_OF_WEEK) + 5) % 7;
    }

    private static JSONObject tick(String type, String grade, String system, double index, String date, String color) throws Exception {
        JSONObject tick = new JSONObject().put("type", type).put("grade", grade).put("grade_system", system)
            .put("grade_index", index).put("route_name", grade + " route").put("date", date);
        if (color != null) tick.put("expand", new JSONObject().put("route", new JSONObject().put("color", color)));
        return tick;
    }

    private static JSONObject route(String name, String wallId, String wallName, String color, String removal) throws Exception {
        JSONObject route = new JSONObject().put("name", name).put("grade", "6a").put("color", color).put("wall", wallId)
            .put("created", "2026-10-20T10:00:00.000Z");
        if (removal != null) route.put("removal_planned_for", removal);
        if (wallName != null) route.put("expand", new JSONObject().put("wall", new JSONObject().put("name", wallName)));
        return route;
    }

    @Test
    public void weekdayStartsOnMonday() {
        assertEquals(0, WidgetData.weekday("2026-10-19"));
        assertEquals(6, WidgetData.weekday("2026-10-25"));
        assertEquals(-1, WidgetData.weekday("someday"));
    }

    @Test
    public void summarizeCountsSendsPerDayAndSkipsAttempts() throws Exception {
        JSONArray ticks = new JSONArray()
            .put(tick("flash", "6b", "font", 12, "2026-10-21", "#E53935"))
            .put(tick("attempt", "8a", "font", 30, "2026-10-21", null))
            .put(tick("top", "6a", "font", 10, "2026-10-19", null))
            .put(tick("top", "6a+", "font", 11, "2026-10-19", null));
        WidgetData.Stats stats = WidgetData.summarize(ticks);
        assertEquals(3, stats.sends);
        assertEquals(1, stats.flashes);
        assertArrayEquals(new int[] { 2, 0, 1, 0, 0, 0, 0 }, stats.days);
        assertEquals("6b", stats.hardest.grade);
        assertEquals("#E53935", stats.hardest.color);
        assertTrue(stats.hardest.flash);
    }

    @Test
    public void hardestComesFromTheMostClimbedGradeSystem() throws Exception {
        JSONArray ticks = new JSONArray()
            .put(tick("top", "7a", "french", 40, "2026-10-21", null))
            .put(tick("top", "6a", "font", 10, "2026-10-20", null))
            .put(tick("top", "6b", "font", 12, "2026-10-20", null));
        WidgetData.Stats stats = WidgetData.summarize(ticks);
        assertEquals("6b", stats.hardest.grade);
        assertEquals("#9E9E9E", stats.hardest.color);
    }

    @Test
    public void aGradeSystemTieGoesToTheNewestSend() throws Exception {
        JSONArray ticks = new JSONArray()
            .put(tick("top", "6c", "french", 20, "2026-10-21", null))
            .put(tick("top", "7a", "font", 40, "2026-10-20", null));
        assertEquals("6c", WidgetData.summarize(ticks).hardest.grade);
    }

    @Test
    public void anEmptyWeekHasNoHardest() throws Exception {
        WidgetData.Stats stats = WidgetData.summarize(new JSONArray().put(tick("attempt", "6a", "font", 10, "2026-10-21", null)));
        assertEquals(0, stats.sends);
        assertNull(stats.hardest);
    }

    @Test
    public void streakIsAtRiskOnlyAfterAnEmptyLastWeek() {
        String lastMonday = daysFromToday(-todayIndex() - 7);
        String dayBefore = daysFromToday(-todayIndex() - 8);
        assertTrue(WidgetData.streakAtRisk(null));
        assertTrue(WidgetData.streakAtRisk(dayBefore));
        assertFalse(WidgetData.streakAtRisk(lastMonday));
        assertFalse(WidgetData.streakAtRisk(daysFromToday(0)));
    }

    @Test
    public void rankMoveCountsFromTheWeeksFirstRank() {
        WidgetData.Stats fresh = new WidgetData.Stats();
        fresh.rank = 7;

        WidgetData.Stats first = WidgetData.withRankMove(fresh, null);
        assertEquals(7, first.rankBase);
        assertEquals(0, first.rankMove);
        assertEquals(WidgetData.weekStart(), first.rankWeek);

        WidgetData.Stats previous = new WidgetData.Stats();
        previous.rankWeek = WidgetData.weekStart();
        previous.rankBase = 10;
        WidgetData.Stats moved = WidgetData.withRankMove(fresh, previous);
        assertEquals(10, moved.rankBase);
        assertEquals(3, moved.rankMove);

        previous.rankWeek = "2020-01-06T00:00:00Z";
        assertEquals(0, WidgetData.withRankMove(fresh, previous).rankMove);
    }

    @Test
    public void rankMoveKeepsTheSharedStatsUntouched() {
        WidgetData.Stats shared = new WidgetData.Stats();
        shared.rank = 7;
        WidgetData.Stats previous = new WidgetData.Stats();
        previous.rankWeek = WidgetData.weekStart();
        previous.rankBase = 9;
        WidgetData.withRankMove(shared, previous);
        assertEquals(0, shared.rankBase);
        assertEquals(0, shared.rankMove);
    }

    @Test
    public void runningSeasonCoversItsFirstAndLastDay() throws Exception {
        String today = daysFromToday(0);
        JSONArray seasons = new JSONArray()
            .put(new JSONObject().put("id", "past").put("starts_at", daysFromToday(-30)).put("ends_at", daysFromToday(-1)))
            .put(new JSONObject().put("id", "now").put("starts_at", today).put("ends_at", today));
        assertEquals("now", WidgetData.runningSeason(seasons));
        assertNull(WidgetData.runningSeason(new JSONArray().put(seasons.get(0))));
    }

    @Test
    public void newRoutesOnFollowedWallsLead() throws Exception {
        JSONArray items = new JSONArray();
        for (int i = 0; i < 9; i++) items.put(route("Route " + i, i == 5 ? "cave" : "slab", "Wall", "#00000" + i, null));
        WidgetData.GymStats stats = new WidgetData.GymStats();
        WidgetData.summarizeNew(stats, items, new HashSet<>(Collections.singletonList("cave")));
        assertTrue(stats.followed);
        assertEquals(3, stats.routes.size());
        assertEquals("Route 5", stats.routes.get(0).name);
        assertEquals("Route 0", stats.routes.get(1).name);
        assertEquals(7, stats.colors.size());
        assertEquals("#000000", stats.colors.get(0));
    }

    @Test
    public void newRoutesWithoutFollowedWallsAreTheNewest() throws Exception {
        JSONArray items = new JSONArray().put(route("A", "slab", null, "#111111", null)).put(route("B", "slab", "Slab", "#222222", null));
        WidgetData.GymStats stats = new WidgetData.GymStats();
        WidgetData.summarizeNew(stats, items, new HashSet<>());
        assertFalse(stats.followed);
        assertEquals(Arrays.asList("A", "B"), Arrays.asList(stats.routes.get(0).name, stats.routes.get(1).name));
        assertEquals("", stats.routes.get(0).wall);
    }

    @Test
    public void nextResetIsTheFirstDateFromTodayWithEveryWall() throws Exception {
        String tomorrow = daysFromToday(1);
        JSONArray items = new JSONArray()
            .put(route("Overdue", "a", "Old", "#111111", daysFromToday(-1)))
            .put(route("One", "b", "Cave", "#111111", tomorrow))
            .put(route("Two", "b", "Cave", "#111111", tomorrow))
            .put(route("Three", "c", "Slab", "#111111", tomorrow))
            .put(route("Later", "d", "Roof", "#111111", daysFromToday(5)));
        WidgetData.GymStats stats = new WidgetData.GymStats();
        WidgetData.nextReset(stats, items);
        assertEquals(tomorrow, stats.resetDate);
        assertEquals("Cave", stats.resetWall);
        assertEquals(1, stats.resetMoreWalls);
    }

    @Test
    public void nextResetCountsToday() throws Exception {
        JSONArray items = new JSONArray().put(route("Now", "a", null, "#111111", daysFromToday(0)));
        WidgetData.GymStats stats = new WidgetData.GymStats();
        WidgetData.nextReset(stats, items);
        assertEquals(daysFromToday(0), stats.resetDate);
        assertEquals("", stats.resetWall);
        assertEquals(0, stats.resetMoreWalls);
    }

    @Test
    public void noResetWhenEveryDateHasPassed() throws Exception {
        WidgetData.GymStats stats = new WidgetData.GymStats();
        WidgetData.nextReset(stats, new JSONArray().put(route("Overdue", "a", "Old", "#111111", daysFromToday(-2))));
        assertNull(stats.resetDate);
        assertNull(stats.resetWall);
    }

    @Test
    public void statsSurviveTheSnapshot() {
        WidgetData.Stats stats = new WidgetData.Stats();
        stats.sends = 4;
        stats.streak = 3;
        stats.streakRisk = true;
        stats.days[2] = 4;
        stats.hardest = new WidgetData.Send("Crimp", "6b", "#E53935", true);
        stats.origin = "https://example.test";
        WidgetData.Stats copy = WidgetData.Stats.fromJson(stats.toJson());
        assertEquals(4, copy.sends);
        assertTrue(copy.streakRisk);
        assertEquals(4, copy.days[2]);
        assertEquals("Crimp", copy.hardest.name);
        assertTrue(copy.hardest.flash);
        assertNull(copy.lastClimb);
        assertEquals("https://example.test", copy.origin);
    }

    @Test
    public void gymStatsSurviveTheSnapshot() {
        WidgetData.GymStats stats = new WidgetData.GymStats();
        stats.hours = "{\"mon\":[[\"09:00\",\"22:00\"]]}";
        stats.newCount = 2;
        stats.routes.add(new WidgetData.NewRoute("A", "6a", "#111111", "Cave", "2026-10-20T10:00:00.000Z"));
        stats.colors.add("#111111");
        stats.resetWall = "Slab";
        stats.resetDate = "2026-10-30";
        stats.origin = "https://example.test";
        WidgetData.GymStats copy = WidgetData.GymStats.fromJson(stats.toJson());
        assertEquals(stats.hours, copy.hours);
        assertEquals("Cave", copy.routes.get(0).wall);
        assertEquals("2026-10-30", copy.resetDate);
        assertNull(copy.lastNew);
        assertNull(copy.slug);
    }
}
