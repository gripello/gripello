package app.gripello.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.format.DateUtils;
import android.text.style.StyleSpan;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;
import app.gripello.R;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

// "My climbing" home-screen widget: the week's sends per day and the streak, wider also the hardest send, rank and flashes.
public class ClimbingWidget extends AppWidgetProvider {

    static final int MEDIUM_MIN_WIDTH_DP = 320;
    private static final int[] DAYS = {
        R.id.widget_day0, R.id.widget_day1, R.id.widget_day2, R.id.widget_day3, R.id.widget_day4, R.id.widget_day5, R.id.widget_day6,
    };
    private static final int CHART_WIDTH_DP = 140;
    private static final int CHART_HEIGHT_DP = 48;

    // The app's bridge (GripelloWidgetPlugin) and the gym picker ask every placed widget, of both kinds, to load again.
    // replace: the session or a gym changed, so a load already running would draw stale numbers.
    public static void updateAll(Context context, boolean replace) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] climbing = ids(context, ClimbingWidget.class);
        int[] gyms = ids(context, GymWidget.class);
        if (climbing.length == 0 && gyms.length == 0) return;
        drawCached(context, manager, climbing);
        GymWidget.drawCached(context, manager, gyms);
        WidgetUpdateJob.schedule(context, replace);
    }

    static int[] ids(Context context, Class<?> provider) {
        return AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(context, provider));
    }

    // Widget ids are unique across providers, so the store keys both kinds by id.
    static int[] placed(Context context) {
        int[] climbing = ids(context, ClimbingWidget.class);
        int[] gyms = ids(context, GymWidget.class);
        int[] all = new int[climbing.length + gyms.length];
        System.arraycopy(climbing, 0, all, 0, climbing.length);
        System.arraycopy(gyms, 0, all, climbing.length, gyms.length);
        return all;
    }

    // The network work runs in WidgetUpdateJob: a broadcast receiver has only seconds, even with goAsync.
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        drawCached(context, manager, ids);
        WidgetUpdateJob.schedule(context, false);
    }

    // The last numbers (or the sign-in prompt) right away, also offline, until the job brings fresh ones.
    static void drawCached(Context context, AppWidgetManager manager, int[] ids) {
        boolean signedIn = WidgetStore.loadSession(context) != null;
        for (int id : ids) {
            WidgetData.Stats cached = signedIn ? WidgetData.cached(context, id) : null;
            if (!signedIn || cached != null) render(context, manager, id, cached);
        }
    }

    // Resizing below API 31 picks the layout again, from the last numbers instead of the network.
    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return;
        WidgetData.Stats stats = WidgetData.cached(context, id);
        if (stats != null && WidgetStore.loadSession(context) != null) render(context, manager, id, stats);
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        for (int id : ids) WidgetStore.forget(context, id);
    }

    static void render(Context context, AppWidgetManager manager, int id, WidgetData.Stats stats) {
        if (stats == null) {
            manager.updateAppWidget(id, signedOut(context, id));
            return;
        }
        String gymName = WidgetStore.gymName(context, id);
        sized(manager, id, small(context, id, stats, gymName), medium(context, id, stats, gymName));
    }

    static RemoteViews signedOut(Context context, int id) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_signed_out);
        views.setOnClickPendingIntent(R.id.widget_root, open(context, id, WidgetData.DEFAULT_ORIGIN + "/auth/login"));
        return views;
    }

    static void sized(AppWidgetManager manager, int id, RemoteViews small, RemoteViews medium) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Map<SizeF, RemoteViews> sizes = new HashMap<>();
            sizes.put(new SizeF(110f, 110f), small);
            sizes.put(new SizeF(MEDIUM_MIN_WIDTH_DP, 110f), medium);
            manager.updateAppWidget(id, new RemoteViews(sizes));
        } else {
            int width = manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH);
            manager.updateAppWidget(id, width >= MEDIUM_MIN_WIDTH_DP ? medium : small);
        }
    }

    private static RemoteViews small(Context context, int id, WidgetData.Stats stats, String gymName) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_small);
        summary(context, views, stats, gymName);
        views.setOnClickPendingIntent(R.id.widget_root, open(context, id, stats.origin + "/logbook"));
        return views;
    }

    private static RemoteViews medium(Context context, int id, WidgetData.Stats stats, String gymName) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_medium);
        summary(context, views, stats, gymName);
        boolean active = stats.sends > 0;

        boolean hardest = active && stats.hardest != null;
        if (hardest) {
            views.setInt(R.id.widget_hardest_dot, "setColorFilter", holdColor(stats.hardest.color));
            views.setTextViewText(R.id.widget_hardest_grade, stats.hardest.grade);
            views.setTextViewText(R.id.widget_hardest_name, stats.hardest.name);
        }
        boolean risk = !active && stats.streak > 0;
        if (risk) views.setTextViewText(R.id.widget_risk_title, streakText(context, stats.streak));
        views.setViewVisibility(R.id.widget_hardest_card, hardest ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_risk_card, risk ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_empty, hardest || risk ? View.GONE : View.VISIBLE);

        boolean rank = stats.rank > 0;
        if (rank) {
            views.setTextViewText(R.id.widget_rank, "#" + stats.rank);
            boolean moved = stats.rankMove != 0;
            views.setViewVisibility(R.id.widget_rank_arrow, moved ? View.VISIBLE : View.GONE);
            views.setViewVisibility(R.id.widget_rank_move, moved ? View.VISIBLE : View.GONE);
            if (moved) {
                boolean up = stats.rankMove > 0;
                views.setImageViewResource(R.id.widget_rank_arrow, up ? R.drawable.widget_up : R.drawable.widget_down);
                views.setTextViewText(R.id.widget_rank_move, String.valueOf(Math.abs(stats.rankMove)));
                views.setTextColor(R.id.widget_rank_move, context.getColor(up ? R.color.widget_brand : R.color.widget_down));
            }
        }
        boolean flashes = active;
        if (flashes) views.setTextViewText(R.id.widget_flashes, String.valueOf(stats.flashes));
        boolean last = !active && stats.lastClimb != null;
        if (last) views.setTextViewText(R.id.widget_last, daysAgo(stats.lastClimb));
        views.setViewVisibility(R.id.widget_rank_card, rank ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_flashes_card, flashes ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_last_card, last ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_cards, rank || flashes || last ? View.VISIBLE : View.GONE);

        views.setOnClickPendingIntent(R.id.widget_root, open(context, id, stats.origin + "/logbook"));
        return views;
    }

    private static void summary(Context context, RemoteViews views, WidgetData.Stats stats, String gymName) {
        views.setTextViewText(R.id.widget_title, gymName != null ? gymName : context.getString(R.string.widget_this_week));
        views.setTextViewText(R.id.widget_sends, String.valueOf(stats.sends));
        int today = today();
        views.setImageViewBitmap(R.id.widget_chart, weekChart(context, stats.days, today));
        SimpleDateFormat narrow = new SimpleDateFormat("EEEEE", Locale.getDefault());
        Calendar day = Calendar.getInstance();
        for (int i = 0; i < DAYS.length; i++) {
            day.set(Calendar.DAY_OF_WEEK, i == 6 ? Calendar.SUNDAY : Calendar.MONDAY + i);
            String label = narrow.format(day.getTime());
            if (i == today) {
                SpannableString bold = new SpannableString(label);
                bold.setSpan(new StyleSpan(Typeface.BOLD), 0, label.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                views.setTextViewText(DAYS[i], bold);
                views.setTextColor(DAYS[i], context.getColor(R.color.widget_text));
            } else {
                views.setTextViewText(DAYS[i], label);
                views.setTextColor(DAYS[i], context.getColor(R.color.widget_muted));
            }
        }
        // A week without sends turns the streak into a reminder that it runs out on Sunday.
        views.setViewVisibility(R.id.widget_streak_chip, stats.streak > 0 ? View.VISIBLE : View.GONE);
        views.setTextViewText(R.id.widget_streak, stats.sends == 0 ? context.getString(R.string.widget_streak_ends) : streakText(context, stats.streak));
    }

    private static String streakText(Context context, int streak) {
        return context.getResources().getQuantityString(R.plurals.widget_streak, streak, streak);
    }

    // Monday = 0.
    static int today() {
        return (Calendar.getInstance().get(Calendar.DAY_OF_WEEK) + 5) % 7;
    }

    // RemoteViews can't size views per value, so the bars are one bitmap the layout stretches over the column.
    static Bitmap weekChart(Context context, int[] days, int today) {
        float density = context.getResources().getDisplayMetrics().density;
        int width = Math.round(CHART_WIDTH_DP * density);
        int height = Math.round(CHART_HEIGHT_DP * density);
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        int max = 1;
        for (int count : days) max = Math.max(max, count);
        float slot = width / 7f;
        float bar = slot * 0.62f;
        float radius = 4 * density;
        for (int i = 0; i < 7; i++) {
            float x = slot * i + (slot - bar) / 2;
            float barHeight = days[i] == 0 ? 4 * density : Math.max(8 * density, height * days[i] / (float) max);
            int color = i == today ? R.color.widget_brand : days[i] == 0 ? R.color.widget_track : R.color.widget_bar;
            paint.setColor(context.getColor(color));
            canvas.drawRoundRect(new RectF(x, height - barHeight, x + bar, height), radius, radius, paint);
        }
        return bitmap;
    }

    // "9 days ago" for a plain day (YYYY-MM-DD) on the phone's calendar.
    static CharSequence daysAgo(String day) {
        try {
            Date date = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).parse(day);
            if (date == null) return "";
            return DateUtils.getRelativeTimeSpanString(date.getTime(), System.currentTimeMillis(), DateUtils.DAY_IN_MILLIS);
        } catch (ParseException e) {
            return "";
        }
    }

    // Route hold colours are "#RRGGBB"; anything else is drawn grey like on the site (shared/utils/color.ts).
    static int holdColor(String hex) {
        try {
            return hex != null && hex.matches("#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?") ? Color.parseColor("#" + hex.replace("#", "").substring(0, 6)) : 0xFF9E9E9E;
        } catch (IllegalArgumentException e) {
            return 0xFF9E9E9E;
        }
    }

    // The App Link opens the page inside the app (MainActivity.appLink), never in the browser.
    static PendingIntent open(Context context, int id, String url) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(context.getPackageName()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
