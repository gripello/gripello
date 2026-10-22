package app.gripello.widget;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.text.format.DateUtils;
import android.view.View;
import android.widget.RemoteViews;
import app.gripello.R;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

// "My gym" home-screen widget: open now and the week's new routes, wider also the newest routes or the next reset.
public class GymWidget extends AppWidgetProvider {

    private static final int[] HOLDS = {
        R.id.widget_hold0, R.id.widget_hold1, R.id.widget_hold2, R.id.widget_hold3, R.id.widget_hold4, R.id.widget_hold5, R.id.widget_hold6,
    };
    private static final int[] ROWS = { R.id.widget_route0, R.id.widget_route1, R.id.widget_route2 };
    private static final int[] DOTS = { R.id.widget_route0_dot, R.id.widget_route1_dot, R.id.widget_route2_dot };
    private static final int[] GRADES = { R.id.widget_route0_grade, R.id.widget_route1_grade, R.id.widget_route2_grade };
    private static final int[] NAMES = { R.id.widget_route0_name, R.id.widget_route1_name, R.id.widget_route2_name };
    private static final int[] METAS = { R.id.widget_route0_meta, R.id.widget_route1_meta, R.id.widget_route2_meta };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        drawCached(context, manager, ids);
        WidgetUpdateJob.schedule(context, false);
    }

    static void drawCached(Context context, AppWidgetManager manager, int[] ids) {
        boolean signedIn = WidgetStore.loadSession(context) != null;
        for (int id : ids) {
            WidgetData.GymStats cached = signedIn ? WidgetData.cachedGym(context, id) : null;
            if (!signedIn || cached != null) render(context, manager, id, cached);
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return;
        WidgetData.GymStats stats = WidgetData.cachedGym(context, id);
        if (stats != null && WidgetStore.loadSession(context) != null) render(context, manager, id, stats);
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        for (int id : ids) WidgetStore.forget(context, id);
    }

    static void render(Context context, AppWidgetManager manager, int id, WidgetData.GymStats stats) {
        if (stats == null) {
            manager.updateAppWidget(id, ClimbingWidget.signedOut(context, id));
            return;
        }
        String gymName = WidgetStore.gymName(context, id);
        String url = stats.origin + (stats.slug != null ? "/" + stats.slug : "");
        RemoteViews small = new RemoteViews(context.getPackageName(), R.layout.widget_gym_small);
        summary(context, small, stats, gymName, true);
        small.setOnClickPendingIntent(R.id.widget_root, ClimbingWidget.open(context, id, url));
        RemoteViews medium = new RemoteViews(context.getPackageName(), R.layout.widget_gym_medium);
        summary(context, medium, stats, gymName, false);
        routes(context, medium, stats);
        medium.setOnClickPendingIntent(R.id.widget_root, ClimbingWidget.open(context, id, url));
        ClimbingWidget.sized(manager, id, small, medium);
    }

    private static void summary(Context context, RemoteViews views, WidgetData.GymStats stats, String gymName, boolean small) {
        views.setTextViewText(R.id.widget_title, gymName != null ? gymName : context.getString(R.string.widget_pick_gym));
        // The status follows the clock at drawing time; the job redraws at least every 30 minutes.
        OpeningHours.Status status = OpeningHours.status(stats.hours, Calendar.getInstance());
        views.setViewVisibility(R.id.widget_status_chip, status != null ? View.VISIBLE : View.GONE);
        if (status != null) {
            views.setInt(R.id.widget_status_chip, "setBackgroundResource", status.open ? R.drawable.widget_chip_open : R.drawable.widget_chip_closed);
            views.setInt(R.id.widget_status_dot, "setColorFilter", context.getColor(status.open ? R.color.widget_brand : R.color.widget_muted));
            views.setTextColor(R.id.widget_status, context.getColor(status.open ? R.color.widget_open_text : R.color.widget_text));
            views.setTextViewText(R.id.widget_status, statusText(context, status));
        }
        views.setTextViewText(R.id.widget_new_count, String.valueOf(stats.newCount));

        boolean holds = small && stats.newCount > 0;
        views.setViewVisibility(R.id.widget_holds, holds ? View.VISIBLE : View.GONE);
        for (int i = 0; i < HOLDS.length; i++) {
            boolean shown = holds && i < stats.colors.size();
            views.setViewVisibility(HOLDS[i], shown ? View.VISIBLE : View.GONE);
            if (shown) views.setInt(HOLDS[i], "setColorFilter", ClimbingWidget.holdColor(stats.colors.get(i)));
        }
        // Small: the reset replaces the hold dots of an empty week. Medium: next to the routes, else it is the main card.
        boolean banner = stats.resetDate != null && (small ? stats.newCount == 0 : stats.newCount > 0);
        views.setViewVisibility(R.id.widget_reset_banner, banner ? View.VISIBLE : View.GONE);
        if (banner) views.setTextViewText(R.id.widget_reset, resetText(context, stats));
    }

    private static void routes(Context context, RemoteViews views, WidgetData.GymStats stats) {
        boolean listed = !stats.routes.isEmpty();
        views.setViewVisibility(R.id.widget_routes_label, listed ? View.VISIBLE : View.GONE);
        views.setTextViewText(R.id.widget_routes_label, context.getString(stats.followed ? R.string.widget_followed_walls : R.string.widget_newest));
        for (int i = 0; i < ROWS.length; i++) {
            boolean shown = i < stats.routes.size();
            views.setViewVisibility(ROWS[i], shown ? View.VISIBLE : View.GONE);
            if (!shown) continue;
            WidgetData.NewRoute route = stats.routes.get(i);
            views.setInt(DOTS[i], "setColorFilter", ClimbingWidget.holdColor(route.color));
            views.setTextViewText(GRADES[i], route.grade);
            views.setTextViewText(NAMES[i], route.name);
            views.setTextViewText(METAS[i], join(route.wall, ago(route.created)));
        }
        boolean reset = !listed && stats.resetDate != null;
        views.setViewVisibility(R.id.widget_reset_card, reset ? View.VISIBLE : View.GONE);
        if (reset) views.setTextViewText(R.id.widget_reset_title, join(wallLabel(stats), resetDay(context, stats.resetDate)));
        views.setViewVisibility(R.id.widget_gym_empty, !listed && !reset ? View.VISIBLE : View.GONE);
        boolean last = !listed && stats.lastNew != null;
        views.setViewVisibility(R.id.widget_lastnew_card, last ? View.VISIBLE : View.GONE);
        if (last) views.setTextViewText(R.id.widget_lastnew, join(stats.lastNew.wall, ago(stats.lastNew.created)));
    }

    private static String statusText(Context context, OpeningHours.Status status) {
        if (status.open) return context.getString(R.string.widget_open_until, status.time);
        if (status.time.isEmpty()) return context.getString(R.string.widget_closed);
        if (status.day < 0) return context.getString(R.string.widget_closed_opens, status.time);
        Calendar day = Calendar.getInstance();
        day.set(Calendar.DAY_OF_WEEK, status.day == 6 ? Calendar.SUNDAY : Calendar.MONDAY + status.day);
        String weekday = new SimpleDateFormat("EEE", Locale.getDefault()).format(day.getTime());
        return context.getString(R.string.widget_closed_opens_day, status.time, weekday);
    }

    private static String resetText(Context context, WidgetData.GymStats stats) {
        String day = resetDay(context, stats.resetDate);
        String wall = wallLabel(stats);
        return wall.isEmpty() ? context.getString(R.string.widget_reset_on, day) : context.getString(R.string.widget_resets, wall, day);
    }

    private static String wallLabel(WidgetData.GymStats stats) {
        if (stats.resetWall == null || stats.resetWall.isEmpty()) return "";
        return stats.resetMoreWalls > 0 ? stats.resetWall + " +" + stats.resetMoreWalls : stats.resetWall;
    }

    private static String resetDay(Context context, String day) {
        try {
            Date date = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).parse(day);
            if (date == null) return day;
            return DateUtils.formatDateTime(context, date.getTime(),
                DateUtils.FORMAT_SHOW_WEEKDAY | DateUtils.FORMAT_ABBREV_WEEKDAY | DateUtils.FORMAT_SHOW_DATE
                    | DateUtils.FORMAT_ABBREV_MONTH | DateUtils.FORMAT_NO_YEAR);
        } catch (ParseException e) {
            return day;
        }
    }

    // "Yesterday", "3 days ago" for an API timestamp (RFC 3339 UTC with milliseconds).
    private static CharSequence ago(String timestamp) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        try {
            Date date = format.parse(timestamp);
            if (date == null) return "";
            return DateUtils.getRelativeTimeSpanString(date.getTime(), System.currentTimeMillis(), DateUtils.DAY_IN_MILLIS, DateUtils.FORMAT_ABBREV_RELATIVE);
        } catch (ParseException e) {
            return "";
        }
    }

    private static String join(CharSequence first, CharSequence second) {
        if (first == null || first.length() == 0) return second.toString();
        if (second.length() == 0) return first.toString();
        return first + " · " + second;
    }
}
