package com.frenchflair.libvr;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.TextView;

/**
 * Démarre le serveur local puis ouvre la Bibliothèque VR dans le Quest Browser.
 * Il ne reste ensuite qu'à appuyer sur « Entrer en VR ».
 */
public final class LauncherActivity extends Activity {

    private static final String URL = "http://localhost:" + ServerService.PORT + "/";
    private static final String QUEST_BROWSER = "com.oculus.browser";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView text;
    private int tries;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        text = new TextView(this);
        text.setGravity(Gravity.CENTER);
        text.setTextSize(22);
        text.setPadding(48, 48, 48, 48);
        text.setText(AppConfig.NAME + "\n\nOuverture dans le navigateur…");
        setContentView(text);
        startForegroundService(new Intent(this, ServerService.class));
    }

    @Override
    protected void onResume() {
        super.onResume();
        tries = 0;
        handler.post(this::openWhenReady);
    }

    @Override
    protected void onPause() {
        handler.removeCallbacksAndMessages(null);
        super.onPause();
    }

    private void openWhenReady() {
        if (!ServerService.isRunning()) {
            if (++tries > 50) {
                text.setText(AppConfig.NAME + "\n\nLe serveur local n'a pas pu démarrer.\nRedémarrez l'application.");
                return;
            }
            handler.postDelayed(this::openWhenReady, 100);
            return;
        }
        Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(URL));
        view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        view.setPackage(QUEST_BROWSER);
        try {
            startActivity(view);
        } catch (ActivityNotFoundException e) {
            view.setPackage(null); // hors Quest : n'importe quel navigateur
            try {
                startActivity(view);
            } catch (ActivityNotFoundException e2) {
                text.setText(AppConfig.NAME + "\n\nAucun navigateur trouvé.\nOuvrez " + URL);
                return;
            }
        }
        text.setText(AppConfig.NAME + "\n\nOuverte dans le navigateur.\nAppuyez sur « Entrer en VR ».");
    }
}
