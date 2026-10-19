package app.gripello.widget;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// A job (not the broadcast's few seconds) waits for a network; a new session or gym replaces a running load.
public class WidgetUpdateJob extends JobService {

    private static final int JOB_ID = 0x67726970;

    private final ExecutorService loader = Executors.newSingleThreadExecutor();
    private volatile JobParameters running;
    // A redraw asked for while a load runs; that load may already have read older numbers.
    private static volatile boolean again;

    // A plain redraw (app backgrounded, periodic update) joins a pending or running load instead of cancelling it.
    static void schedule(Context context, boolean replace) {
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        if (scheduler == null) return;
        if (!replace && scheduler.getPendingJob(JOB_ID) != null) {
            again = true;
            return;
        }
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
            boolean placedMeanwhile = false;
            boolean current = false;
            again = false;
            try {
                Map<Integer, WidgetData.Stats> stats = WidgetData.load(context, ids);
                // A stopped run was replaced; the newer one draws its own numbers.
                if (running == params) {
                    current = true;
                    for (int id : ids) ClimbingWidget.render(context, manager, id, stats.get(id));
                    // A widget placed during the load had its onUpdate skipped as joining this run.
                    int[] now = manager.getAppWidgetIds(new ComponentName(context, ClimbingWidget.class));
                    Arrays.sort(ids);
                    Arrays.sort(now);
                    placedMeanwhile = !Arrays.equals(ids, now);
                }
            } finally {
                jobFinished(params, false);
            }
            if (placedMeanwhile || (current && again)) schedule(context, true);
        });
        return true;
    }

    // Stopped by the system (network lost, quota): run again later. A replaced run is cancelled and never retried.
    @Override
    public boolean onStopJob(JobParameters params) {
        if (running == params) running = null;
        return true;
    }

    @Override
    public void onDestroy() {
        loader.shutdown();
        super.onDestroy();
    }
}
