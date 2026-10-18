package app.gripello.widget;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// A job (not the broadcast's few seconds) waits for a network; rescheduling replaces a running load.
public class WidgetUpdateJob extends JobService {

    private static final int JOB_ID = 0x67726970;

    private final ExecutorService loader = Executors.newSingleThreadExecutor();
    private volatile JobParameters running;

    static void schedule(Context context) {
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        if (scheduler == null) return;
        scheduler.schedule(
            new JobInfo.Builder(JOB_ID, new ComponentName(context, WidgetUpdateJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .build()
        );
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        Context context = getApplicationContext();
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, ClimbingWidget.class));
        if (ids.length == 0) return false;
        running = params;
        loader.execute(() -> {
            Map<Integer, WidgetData.Stats> stats = WidgetData.load(context, ids);
            // A stopped run was replaced; the newer one draws its own numbers.
            if (running == params) {
                for (int id : ids) ClimbingWidget.render(context, manager, id, stats.get(id));
            }
            jobFinished(params, false);
        });
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        if (running == params) running = null;
        return false;
    }

    @Override
    public void onDestroy() {
        loader.shutdown();
        super.onDestroy();
    }
}
