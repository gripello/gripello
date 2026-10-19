package app.gripello.widget;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import java.util.Objects;

// The session, each widget's gym and its last good numbers; the widget runs in the app's process.
public final class WidgetStore {

    public static final class Session {
        public final String token;
        public final String userId;
        public final String origin;

        public Session(String token, String userId, String origin) {
            this.token = token;
            this.userId = userId;
            this.origin = origin;
        }
    }

    private static final String PREFS = "gripello.widget";
    private static final String SNAPSHOT = "snapshot.";
    private static final String GYM = "gym.";
    private static final String GYM_NAME = "gymName.";

    private WidgetStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static Session loadSession(Context context) {
        SharedPreferences prefs = prefs(context);
        String token = prefs.getString("token", null);
        String userId = prefs.getString("userId", null);
        String origin = prefs.getString("origin", null);
        return token == null || userId == null || origin == null ? null : new Session(token, userId, origin);
    }

    // Another climber gets none of the previous one's numbers or picked gyms (maybe hidden ones).
    public static synchronized void saveSession(Context context, Session session) {
        String previous = prefs(context).getString("userId", null);
        SharedPreferences.Editor editor = prefs(context).edit();
        if (previous != null && !previous.equals(session.userId)) drop(context, editor, true);
        editor.putString("token", session.token).putString("userId", session.userId).putString("origin", session.origin).apply();
    }

    // Signing out also drops the numbers and the picked gyms of the previous climber.
    public static synchronized void clearSession(Context context) {
        SharedPreferences.Editor editor = prefs(context).edit().remove("token").remove("userId").remove("origin");
        drop(context, editor, true);
        editor.apply();
    }

    // A load that started before a new session must not sign that one out; an expired token keeps the gyms for the same climber.
    public static synchronized void clearSessionIf(Context context, String token) {
        if (!token.equals(prefs(context).getString("token", null))) return;
        SharedPreferences.Editor editor = prefs(context).edit().remove("token");
        drop(context, editor, false);
        editor.apply();
    }

    private static void drop(Context context, SharedPreferences.Editor editor, boolean gyms) {
        for (String key : prefs(context).getAll().keySet()) {
            if (key.startsWith(SNAPSHOT) || (gyms && (key.startsWith(GYM) || key.startsWith(GYM_NAME)))) editor.remove(key);
        }
    }

    // ...nor overwrite it with the renewed old token.
    public static synchronized void replaceSessionIf(Context context, String token, Session next) {
        if (token.equals(prefs(context).getString("token", null))) saveSession(context, next);
    }

    // Another gym's numbers must not show under the new gym's name until the job loads them.
    public static synchronized void saveGym(Context context, int widgetId, String gymId, String gymName) {
        SharedPreferences.Editor editor = prefs(context).edit().putString(GYM + widgetId, gymId).putString(GYM_NAME + widgetId, gymName);
        if (!Objects.equals(gymId, gymId(context, widgetId))) editor.remove(SNAPSHOT + widgetId);
        editor.apply();
    }

    public static String gymId(Context context, int widgetId) {
        return prefs(context).getString(GYM + widgetId, null);
    }

    public static String gymName(Context context, int widgetId) {
        return prefs(context).getString(GYM_NAME + widgetId, null);
    }

    // A load that outlived a sign-out, a new session, another gym or the widget itself keeps its numbers to itself.
    public static synchronized void saveSnapshotIf(Context context, int widgetId, String json, String token, String gymId) {
        SharedPreferences prefs = prefs(context);
        if (!token.equals(prefs.getString("token", null))) return;
        if (!Objects.equals(gymId, gymId(context, widgetId))) return;
        int[] placed = AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(context, ClimbingWidget.class));
        for (int id : placed) {
            if (id == widgetId) {
                prefs.edit().putString(SNAPSHOT + widgetId, json).apply();
                return;
            }
        }
    }

    public static String snapshot(Context context, int widgetId) {
        return prefs(context).getString(SNAPSHOT + widgetId, null);
    }

    public static synchronized void forget(Context context, int widgetId) {
        prefs(context).edit().remove(GYM + widgetId).remove(GYM_NAME + widgetId).remove(SNAPSHOT + widgetId).apply();
    }
}
