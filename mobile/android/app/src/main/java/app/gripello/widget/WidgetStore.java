package app.gripello.widget;

import android.content.Context;
import android.content.SharedPreferences;

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

    public static synchronized void saveSession(Context context, Session session) {
        prefs(context).edit().putString("token", session.token).putString("userId", session.userId).putString("origin", session.origin).apply();
    }

    // Signing out also drops the numbers drawn for the previous climber.
    public static synchronized void clearSession(Context context) {
        SharedPreferences.Editor editor = prefs(context).edit().remove("token").remove("userId").remove("origin");
        for (String key : prefs(context).getAll().keySet()) if (key.startsWith(SNAPSHOT)) editor.remove(key);
        editor.apply();
    }

    // A load that started before the app handed over a new session must not sign that one out.
    public static synchronized void clearSessionIf(Context context, String token) {
        if (token.equals(prefs(context).getString("token", null))) clearSession(context);
    }

    // ...nor overwrite it with the renewed old token.
    public static synchronized void replaceSessionIf(Context context, String token, Session next) {
        if (token.equals(prefs(context).getString("token", null))) saveSession(context, next);
    }

    public static void saveGym(Context context, int widgetId, String gymId, String gymName) {
        prefs(context).edit().putString("gym." + widgetId, gymId).putString("gymName." + widgetId, gymName).apply();
    }

    public static String gymId(Context context, int widgetId) {
        return prefs(context).getString("gym." + widgetId, null);
    }

    public static String gymName(Context context, int widgetId) {
        return prefs(context).getString("gymName." + widgetId, null);
    }

    public static void saveSnapshot(Context context, int widgetId, String json) {
        prefs(context).edit().putString(SNAPSHOT + widgetId, json).apply();
    }

    public static String snapshot(Context context, int widgetId) {
        return prefs(context).getString(SNAPSHOT + widgetId, null);
    }

    public static void forget(Context context, int widgetId) {
        prefs(context).edit().remove("gym." + widgetId).remove("gymName." + widgetId).remove(SNAPSHOT + widgetId).apply();
    }
}
