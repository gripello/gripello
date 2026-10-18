package app.gripello.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;
import app.gripello.R;
import java.util.HashMap;
import java.util.Map;

// "My climbing" home-screen widget: the week's sends, flashes and streak, wider also the hardest and latest sends.
public class ClimbingWidget extends AppWidgetProvider {

    private static final int MEDIUM_MIN_WIDTH_DP = 250;
    private static final int[] ROWS = { R.id.widget_row1, R.id.widget_row2, R.id.widget_row3 };
    private static final int[] DOTS = { R.id.widget_row1_dot, R.id.widget_row2_dot, R.id.widget_row3_dot };
    private static final int[] GRADES = { R.id.widget_row1_grade, R.id.widget_row2_grade, R.id.widget_row3_grade };
    private static final int[] NAMES = { R.id.widget_row1_name, R.id.widget_row2_name, R.id.widget_row3_name };
    private static final int[] FLASHES = { R.id.widget_row1_flash, R.id.widget_row2_flash, R.id.widget_row3_flash };

    // The app's bridge (GripelloWidgetPlugin) and the gym picker ask every placed widget to load again.
    public static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, ClimbingWidget.class));
        if (ids.length == 0) return;
        drawCached(context, manager, ids);
        WidgetUpdateJob.schedule(context);
    }

    // The network work runs in WidgetUpdateJob: a broadcast receiver has only seconds, even with goAsync.
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        drawCached(context, manager, ids);
        WidgetUpdateJob.schedule(context);
    }

    // The last numbers (or the sign-in prompt) right away, also offline, until the job brings fresh ones.
    private static void drawCached(Context context, AppWidgetManager manager, int[] ids) {
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
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_signed_out);
            views.setOnClickPendingIntent(R.id.widget_root, open(context, id, WidgetData.DEFAULT_ORIGIN + "/auth/login"));
            manager.updateAppWidget(id, views);
            return;
        }
        String gymName = WidgetStore.gymName(context, id);
        RemoteViews small = small(context, id, stats, gymName);
        RemoteViews medium = medium(context, id, stats, gymName);
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
        if (stats.hardest != null) {
            views.setTextViewText(R.id.widget_hardest, context.getString(R.string.widget_hardest, stats.hardest.grade));
        }
        views.setViewVisibility(R.id.widget_hardest, stats.hardest != null ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_empty, stats.latest.isEmpty() ? View.VISIBLE : View.GONE);
        for (int i = 0; i < ROWS.length; i++) {
            boolean shown = i < stats.latest.size();
            views.setViewVisibility(ROWS[i], shown ? View.VISIBLE : View.GONE);
            if (!shown) continue;
            WidgetData.Send send = stats.latest.get(i);
            views.setInt(DOTS[i], "setColorFilter", holdColor(send.color));
            views.setTextViewText(GRADES[i], send.grade);
            views.setTextViewText(NAMES[i], send.name);
            views.setViewVisibility(FLASHES[i], send.flash ? View.VISIBLE : View.GONE);
        }
        views.setOnClickPendingIntent(R.id.widget_root, open(context, id, stats.origin + "/logbook"));
        return views;
    }

    private static void summary(Context context, RemoteViews views, WidgetData.Stats stats, String gymName) {
        views.setTextViewText(R.id.widget_title, gymName != null ? gymName : context.getString(R.string.widget_this_week));
        views.setTextViewText(R.id.widget_sends, String.valueOf(stats.sends));
        views.setTextViewText(R.id.widget_flashes, context.getString(R.string.widget_flashes, stats.flashes));
        views.setViewVisibility(R.id.widget_flashes_row, stats.flashes > 0 ? View.VISIBLE : View.GONE);
        views.setTextViewText(R.id.widget_streak, context.getResources().getQuantityString(R.plurals.widget_streak, stats.streak, stats.streak));
        boolean unread = stats.unread > 0;
        views.setTextViewText(R.id.widget_unread, String.valueOf(stats.unread));
        views.setViewVisibility(R.id.widget_unread, unread ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_unread_icon, unread ? View.VISIBLE : View.GONE);
    }

    // Route hold colours are "#RRGGBB"; anything else is drawn grey like on the site (shared/utils/color.ts).
    private static int holdColor(String hex) {
        try {
            return hex != null && hex.matches("#?[0-9a-fA-F]{6}([0-9a-fA-F]{2})?") ? Color.parseColor("#" + hex.replace("#", "").substring(0, 6)) : 0xFF9E9E9E;
        } catch (IllegalArgumentException e) {
            return 0xFF9E9E9E;
        }
    }

    // The App Link opens the page inside the app (MainActivity.appLink), never in the browser.
    private static PendingIntent open(Context context, int id, String url) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(context.getPackageName()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
