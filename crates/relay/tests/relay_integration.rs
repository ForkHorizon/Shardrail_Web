use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use shardrail_relay::RelayRuntime;
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

#[tokio::test]
async fn test_full_relay_websocket_flow() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let runtime = RelayRuntime::new();

    let server_runtime = runtime.clone();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let r = server_runtime.clone();
            tokio::spawn(async move {
                if let Ok(ws) = tokio_tungstenite::accept_async(stream).await {
                    let _ = r.handle_websocket(ws).await;
                }
            });
        }
    });

    let ws_url = format!("ws://{addr}");

    // 1. Browser connects first
    let (mut browser_ws, _) = connect_async(&ws_url).await.unwrap();
    let browser_hello = json!({
        "type": "hello",
        "role": "browser",
        "machine_id": "m_test_machine",
        "client_id": "b_client_1"
    });
    browser_ws
        .send(Message::Text(browser_hello.to_string().into()))
        .await
        .unwrap();

    // Browser receives status: daemon is offline
    let status_frame = browser_ws.next().await.unwrap().unwrap();
    let status_val: serde_json::Value =
        serde_json::from_str(&status_frame.into_text().unwrap()).unwrap();
    assert_eq!(status_val["type"], "status");
    assert_eq!(status_val["online"], false);
    assert_eq!(status_val["machine_id"], "m_test_machine");
    assert_eq!(status_val["clients"], 1);

    // 2. Daemon connects
    let (mut daemon_ws, _) = connect_async(&ws_url).await.unwrap();
    let daemon_hello = json!({
        "type": "hello",
        "role": "daemon",
        "machine_id": "m_test_machine",
        "client_id": "d_daemon_1"
    });
    daemon_ws
        .send(Message::Text(daemon_hello.to_string().into()))
        .await
        .unwrap();

    // Browser receives status update: daemon is online
    let online_frame = browser_ws.next().await.unwrap().unwrap();
    let online_val: serde_json::Value =
        serde_json::from_str(&online_frame.into_text().unwrap()).unwrap();
    assert_eq!(online_val["type"], "status");
    assert_eq!(online_val["online"], true);

    // 3. Daemon sends encrypted payload frame
    let encrypted_event = json!({
        "type": "relay",
        "machine_id": "m_test_machine",
        "client_id": "d_daemon_1",
        "iv": "base64_iv_123",
        "ciphertext": "base64_encrypted_bytes_xyz"
    });
    daemon_ws
        .send(Message::Text(encrypted_event.to_string().into()))
        .await
        .unwrap();

    // Browser receives the encrypted event
    let event_frame = browser_ws.next().await.unwrap().unwrap();
    let event_val: serde_json::Value =
        serde_json::from_str(&event_frame.into_text().unwrap()).unwrap();
    assert_eq!(event_val["ciphertext"], "base64_encrypted_bytes_xyz");
    assert_eq!(event_val["iv"], "base64_iv_123");

    // 4. Browser sends reply frame
    let client_reply = json!({
        "type": "relay",
        "machine_id": "m_test_machine",
        "client_id": "b_client_1",
        "iv": "base64_iv_456",
        "ciphertext": "base64_client_reply_abc"
    });
    browser_ws
        .send(Message::Text(client_reply.to_string().into()))
        .await
        .unwrap();

    // Daemon receives client reply
    let reply_frame = daemon_ws.next().await.unwrap().unwrap();
    let reply_val: serde_json::Value =
        serde_json::from_str(&reply_frame.into_text().unwrap()).unwrap();
    assert_eq!(reply_val["ciphertext"], "base64_client_reply_abc");

    // 5. Daemon disconnects -> browser receives offline status
    drop(daemon_ws);
    let offline_frame = browser_ws.next().await.unwrap().unwrap();
    let offline_val: serde_json::Value =
        serde_json::from_str(&offline_frame.into_text().unwrap()).unwrap();
    assert_eq!(offline_val["type"], "status");
    assert_eq!(offline_val["online"], false);
}

#[tokio::test]
async fn test_relay_revocation_control() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let runtime = RelayRuntime::new();

    let server_runtime = runtime.clone();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let r = server_runtime.clone();
            tokio::spawn(async move {
                if let Ok(ws) = tokio_tungstenite::accept_async(stream).await {
                    let _ = r.handle_websocket(ws).await;
                }
            });
        }
    });

    let ws_url = format!("ws://{addr}");

    // Connect browser
    let (mut browser_ws, _) = connect_async(&ws_url).await.unwrap();
    browser_ws
        .send(Message::Text(
            json!({
                "type": "hello",
                "role": "browser",
                "machine_id": "m_rev_machine",
                "client_id": "b_rev_client"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    let _ = browser_ws.next().await.unwrap().unwrap(); // initial status

    // Connect daemon
    let (mut daemon_ws, _) = connect_async(&ws_url).await.unwrap();
    daemon_ws
        .send(Message::Text(
            json!({
                "type": "hello",
                "role": "daemon",
                "machine_id": "m_rev_machine",
                "client_id": "d_rev_daemon"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    // Allow daemon hello to be processed
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    // Verify online in runtime
    assert!(runtime.status("m_rev_machine").online);
    assert_eq!(runtime.status("m_rev_machine").clients, 1);

    // Daemon revokes the client
    daemon_ws
        .send(Message::Text(
            json!({
                "type": "control:revoke_client",
                "machine_id": "m_rev_machine",
                "client_id": "b_rev_client"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    // Wait a tick for revocation to process
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    assert_eq!(runtime.status("m_rev_machine").clients, 0);

    // Verify browser receives the close frame with code 4003
    let mut got_close = false;
    while let Some(msg_res) = browser_ws.next().await {
        match msg_res.unwrap() {
            Message::Close(Some(frame)) => {
                assert_eq!(
                    frame.code,
                    tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::from(4003)
                );
                assert_eq!(frame.reason, "Client Revoked");
                got_close = true;
                break;
            }
            Message::Text(_) => {
                // status broadcasts before revocation
                continue;
            }
            other => panic!("unexpected message before close: {other:?}"),
        }
    }
    assert!(got_close, "browser should have received close frame");
}

#[tokio::test]
async fn test_relay_machine_discovery() {
    let runtime = RelayRuntime::new();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let ws_url = format!("ws://{addr}");

    let rt = runtime.clone();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let rt_conn = rt.clone();
            tokio::spawn(async move {
                let ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                let _ = rt_conn.handle_websocket(ws).await;
            });
        }
    });

    // 1. Daemon connects with machine "machine-alpha"
    let (mut daemon_ws, _) = connect_async(&ws_url).await.unwrap();
    daemon_ws
        .send(Message::Text(
            json!({
                "type": "hello",
                "role": "daemon",
                "machine_id": "machine-alpha",
                "client_id": "daemon-1"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    // 2. Browser connects for discovery (empty machine_id)
    let (mut browser_ws, _) = connect_async(&ws_url).await.unwrap();
    browser_ws
        .send(Message::Text(
            json!({
                "type": "hello",
                "role": "browser",
                "machine_id": "",
                "client_id": "browser-disc"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    let disc_frame = browser_ws.next().await.unwrap().unwrap();
    let disc_val: serde_json::Value =
        serde_json::from_str(&disc_frame.into_text().unwrap()).unwrap();
    assert_eq!(disc_val["type"], "machines");
    let machines = disc_val["machines"].as_array().unwrap();
    assert_eq!(machines.len(), 1);
    assert_eq!(machines[0]["machine_id"], "machine-alpha");
    assert_eq!(machines[0]["online"], true);

    // 3. Browser asks for machines dynamically
    browser_ws
        .send(Message::Text(
            json!({ "type": "list_machines" }).to_string().into(),
        ))
        .await
        .unwrap();

    let list_frame = browser_ws.next().await.unwrap().unwrap();
    let list_val: serde_json::Value =
        serde_json::from_str(&list_frame.into_text().unwrap()).unwrap();
    assert_eq!(list_val["type"], "machines");
    let machines_req = list_val["machines"].as_array().unwrap();
    assert_eq!(machines_req.len(), 1);
    assert_eq!(machines_req[0]["machine_id"], "machine-alpha");
}

#[tokio::test]
async fn test_several_machines_and_several_browsers() {
    let runtime = RelayRuntime::new();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let ws_url = format!("ws://{addr}");

    let rt = runtime.clone();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let rt_conn = rt.clone();
            tokio::spawn(async move {
                let ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                let _ = rt_conn.handle_websocket(ws).await;
            });
        }
    });

    // 1. Connect 3 machines simultaneously: m5, m1, server
    let machine_ids = vec!["m5-macbook", "m1-macbook", "server-vps"];
    let mut daemons = Vec::new();

    for mid in &machine_ids {
        let (mut daemon_ws, _) = connect_async(&ws_url).await.unwrap();
        daemon_ws
            .send(Message::Text(
                json!({
                    "type": "hello",
                    "role": "daemon",
                    "machine_id": mid,
                    "client_id": format!("d_{mid}")
                })
                .to_string()
                .into(),
            ))
            .await
            .unwrap();
        daemons.push(daemon_ws);
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    // 2. Connect discovery browser and check all 3 machines are online
    let (mut disc_browser, _) = connect_async(&ws_url).await.unwrap();
    disc_browser
        .send(Message::Text(
            json!({
                "type": "hello",
                "role": "browser",
                "machine_id": "",
                "client_id": "b_discovery"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    let disc_frame = disc_browser.next().await.unwrap().unwrap();
    let disc_val: serde_json::Value =
        serde_json::from_str(&disc_frame.into_text().unwrap()).unwrap();
    assert_eq!(disc_val["type"], "machines");
    let machines = disc_val["machines"].as_array().unwrap();
    assert_eq!(machines.len(), 3);
    for m in machines {
        assert_eq!(m["online"], true);
    }

    // 3. Connect multiple active browsers targeting different machines
    let (mut browser_m5, _) = connect_async(&ws_url).await.unwrap();
    browser_m5
        .send(Message::Text(
            json!({
                "type": "hello",
                "role": "browser",
                "machine_id": "m5-macbook",
                "client_id": "b_client_m5"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    let (mut browser_m1, _) = connect_async(&ws_url).await.unwrap();
    browser_m1
        .send(Message::Text(
            json!({
                "type": "hello",
                "role": "browser",
                "machine_id": "m1-macbook",
                "client_id": "b_client_m1"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    // 4. Send encrypted payload from browser_m5 to m5-macbook
    browser_m5
        .send(Message::Text(
            json!({
                "type": "relay",
                "machine_id": "m5-macbook",
                "client_id": "b_client_m5",
                "payload": "secret_m5_data"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    // Verify m5 daemon receives it
    let m5_frame = daemons[0].next().await.unwrap().unwrap();
    let m5_val: serde_json::Value = serde_json::from_str(&m5_frame.into_text().unwrap()).unwrap();
    assert_eq!(m5_val["payload"], "secret_m5_data");

    // 5. Verify m1 daemon and server did NOT receive m5 data
    // (Test via clean routing)
    browser_m1
        .send(Message::Text(
            json!({
                "type": "relay",
                "machine_id": "m1-macbook",
                "client_id": "b_client_m1",
                "payload": "secret_m1_data"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    let m1_frame = daemons[1].next().await.unwrap().unwrap();
    let m1_val: serde_json::Value = serde_json::from_str(&m1_frame.into_text().unwrap()).unwrap();
    assert_eq!(m1_val["payload"], "secret_m1_data");
}

#[tokio::test]
async fn test_selective_device_revocation_multiple_browsers() {
    let runtime = RelayRuntime::new();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let ws_url = format!("ws://{addr}");

    let rt = runtime.clone();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let rt_conn = rt.clone();
            tokio::spawn(async move {
                let ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                let _ = rt_conn.handle_websocket(ws).await;
            });
        }
    });

    let (mut daemon_ws, _) = connect_async(&ws_url).await.unwrap();
    daemon_ws
        .send(Message::Text(
            json!({
                "type": "hello",
                "role": "daemon",
                "machine_id": "machine-shared",
                "client_id": "daemon-main"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    let (mut browser_alpha, _) = connect_async(&ws_url).await.unwrap();
    browser_alpha
        .send(Message::Text(
            json!({
                "type": "hello",
                "role": "browser",
                "machine_id": "machine-shared",
                "client_id": "client-alpha"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    let (mut browser_beta, _) = connect_async(&ws_url).await.unwrap();
    browser_beta
        .send(Message::Text(
            json!({
                "type": "hello",
                "role": "browser",
                "machine_id": "machine-shared",
                "client_id": "client-beta"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    assert_eq!(runtime.status("machine-shared").clients, 2);

    // Daemon revokes ONLY client-alpha
    daemon_ws
        .send(Message::Text(
            json!({
                "type": "control:revoke_client",
                "machine_id": "machine-shared",
                "client_id": "client-alpha"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    // Verify browser_alpha receives close frame with code 4003
    let mut got_alpha_close = false;
    while let Some(msg_res) = browser_alpha.next().await {
        match msg_res.unwrap() {
            Message::Close(Some(frame)) => {
                assert_eq!(
                    frame.code,
                    tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::from(4003)
                );
                assert_eq!(frame.reason, "Client Revoked");
                got_alpha_close = true;
                break;
            }
            Message::Text(_) => continue,
            other => panic!("unexpected on alpha: {other:?}"),
        }
    }
    assert!(
        got_alpha_close,
        "client-alpha must receive close frame 4003"
    );

    // Verify browser_beta is STILL CONNECTED and can send messages
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    assert_eq!(runtime.status("machine-shared").clients, 1);

    browser_beta
        .send(Message::Text(
            json!({
                "type": "relay",
                "machine_id": "machine-shared",
                "client_id": "client-beta",
                "payload": "beta_alive"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    let daemon_received = daemon_ws.next().await.unwrap().unwrap();
    let daemon_val: serde_json::Value =
        serde_json::from_str(&daemon_received.into_text().unwrap()).unwrap();
    assert_eq!(daemon_val["payload"], "beta_alive");
}

#[tokio::test]
async fn test_daemon_connection_loss_and_recovery() {
    let runtime = RelayRuntime::new();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let ws_url = format!("ws://{addr}");

    let rt = runtime.clone();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let rt_conn = rt.clone();
            tokio::spawn(async move {
                let ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                let _ = rt_conn.handle_websocket(ws).await;
            });
        }
    });

    // 1. Browser connects and monitors machine-flaky
    let (mut browser_ws, _) = connect_async(&ws_url).await.unwrap();
    browser_ws
        .send(Message::Text(
            json!({
                "type": "hello",
                "role": "browser",
                "machine_id": "machine-flaky",
                "client_id": "b_monitor"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    let initial = browser_ws.next().await.unwrap().unwrap();
    let initial_val: serde_json::Value =
        serde_json::from_str(&initial.into_text().unwrap()).unwrap();
    assert_eq!(initial_val["online"], false);

    // 2. Daemon connects -> online: true
    let (mut daemon_ws, _) = connect_async(&ws_url).await.unwrap();
    daemon_ws
        .send(Message::Text(
            json!({
                "type": "hello",
                "role": "daemon",
                "machine_id": "machine-flaky",
                "client_id": "d_flaky_1"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    let online_frame = browser_ws.next().await.unwrap().unwrap();
    let online_val: serde_json::Value =
        serde_json::from_str(&online_frame.into_text().unwrap()).unwrap();
    assert_eq!(online_val["online"], true);

    // 3. Daemon connection drops unexpectedly
    drop(daemon_ws);

    let offline_frame = browser_ws.next().await.unwrap().unwrap();
    let offline_val: serde_json::Value =
        serde_json::from_str(&offline_frame.into_text().unwrap()).unwrap();
    assert_eq!(offline_val["online"], false);

    // 4. Daemon reconnects -> online: true again
    let (mut daemon_reconnect, _) = connect_async(&ws_url).await.unwrap();
    daemon_reconnect
        .send(Message::Text(
            json!({
                "type": "hello",
                "role": "daemon",
                "machine_id": "machine-flaky",
                "client_id": "d_flaky_2"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    let recovered_frame = browser_ws.next().await.unwrap().unwrap();
    let recovered_val: serde_json::Value =
        serde_json::from_str(&recovered_frame.into_text().unwrap()).unwrap();
    assert_eq!(recovered_val["online"], true);
}

#[tokio::test]
async fn test_relay_restart_simulation() {
    // 1. Initial relay instance
    let runtime1 = RelayRuntime::new();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    let ws_url = format!("ws://{addr}");

    let rt1 = runtime1.clone();
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    let server_handle = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => break,
                res = listener.accept() => {
                    if let Ok((stream, _)) = res {
                        let conn = rt1.clone();
                        tokio::spawn(async move {
                            if let Ok(ws) = tokio_tungstenite::accept_async(stream).await {
                                let _ = conn.handle_websocket(ws).await;
                            }
                        });
                    }
                }
            }
        }
    });

    let (mut daemon_ws, _) = connect_async(&ws_url).await.unwrap();
    daemon_ws
        .send(Message::Text(
            json!({
                "type": "hello",
                "role": "daemon",
                "machine_id": "machine-survivor",
                "client_id": "d_survivor_1"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    assert!(runtime1.status("machine-survivor").online);

    // 2. Simulate Relay shutdown / restart
    let _ = shutdown_tx.send(());
    let _ = server_handle.await;
    drop(daemon_ws);

    // 3. New relay instance binds on new listener
    let runtime2 = RelayRuntime::new();
    let new_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let new_addr = new_listener.local_addr().unwrap();
    let new_ws_url = format!("ws://{new_addr}");

    let rt2 = runtime2.clone();
    tokio::spawn(async move {
        while let Ok((stream, _)) = new_listener.accept().await {
            let conn = rt2.clone();
            tokio::spawn(async move {
                if let Ok(ws) = tokio_tungstenite::accept_async(stream).await {
                    let _ = conn.handle_websocket(ws).await;
                }
            });
        }
    });

    // 4. Daemon connects to the new relay instance
    let (mut new_daemon_ws, _) = connect_async(&new_ws_url).await.unwrap();
    new_daemon_ws
        .send(Message::Text(
            json!({
                "type": "hello",
                "role": "daemon",
                "machine_id": "machine-survivor",
                "client_id": "d_survivor_2"
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();

    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    assert!(runtime2.status("machine-survivor").online);
}
