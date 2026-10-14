package com.zfqxuz.thlyrics;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaSessionPlugin.class);
        registerPlugin(LocalAudioPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
