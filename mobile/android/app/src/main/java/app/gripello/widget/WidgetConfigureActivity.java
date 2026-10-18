package app.gripello.widget;

import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;
import android.widget.ArrayAdapter;
import android.widget.ListView;
import androidx.appcompat.app.AppCompatActivity;
import app.gripello.R;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

// Picks the gym a widget counts (long-press → widget settings); the first entry keeps all gyms.
public class WidgetConfigureActivity extends AppCompatActivity {

    private final ExecutorService loader = Executors.newSingleThreadExecutor();
    private final List<String> ids = new ArrayList<>();
    private final List<String> names = new ArrayList<>();
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Backing out leaves a newly placed widget unplaced, as the launcher expects.
        setResult(RESULT_CANCELED);
        Bundle extras = getIntent().getExtras();
        if (extras != null) widgetId = extras.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }
        setTitle(R.string.widget_choose_gym);
        ids.add(null);
        names.add(getString(R.string.widget_all_gyms));
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, names);
        ListView list = new ListView(this);
        list.setAdapter(adapter);
        list.setOnItemClickListener((parent, view, position, row) -> choose(ids.get(position), position == 0 ? null : names.get(position)));
        setContentView(list);
        loader.execute(() -> {
            try {
                JSONArray gyms = WidgetData.gyms(this);
                runOnUiThread(() -> {
                    for (int i = 0; i < gyms.length(); i++) {
                        JSONObject gym = gyms.optJSONObject(i);
                        if (gym == null) continue;
                        ids.add(gym.optString("id"));
                        names.add(gym.optString("name"));
                    }
                    adapter.notifyDataSetChanged();
                });
            } catch (Exception ignored) {
                // Offline: "All gyms" still works.
            }
        });
    }

    @Override
    protected void onDestroy() {
        loader.shutdownNow();
        super.onDestroy();
    }

    private void choose(String gymId, String gymName) {
        WidgetStore.saveGym(this, widgetId, gymId, gymName);
        ClimbingWidget.updateAll(this);
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
        finish();
    }
}
