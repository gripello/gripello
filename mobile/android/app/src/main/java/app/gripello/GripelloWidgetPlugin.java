package app.gripello;

import app.gripello.widget.ClimbingWidget;
import app.gripello.widget.WidgetStore;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// The web app (app/utils/widget.ts) hands its session to the home-screen widget and asks it to redraw.
@CapacitorPlugin(name = "GripelloWidget")
public class GripelloWidgetPlugin extends Plugin {

    @PluginMethod
    public void setSession(PluginCall call) {
        String token = call.getString("token");
        String userId = call.getString("userId");
        String origin = call.getString("origin");
        if (token == null || userId == null || origin == null) {
            call.reject("token, userId and origin are required");
            return;
        }
        WidgetStore.saveSession(getContext(), new WidgetStore.Session(token, userId, origin));
        ClimbingWidget.updateAll(getContext(), true);
        call.resolve();
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        WidgetStore.clearSession(getContext());
        ClimbingWidget.updateAll(getContext(), true);
        call.resolve();
    }

    @PluginMethod
    public void reload(PluginCall call) {
        ClimbingWidget.updateAll(getContext(), false);
        call.resolve();
    }
}
