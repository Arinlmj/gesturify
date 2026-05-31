import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Aperture,
  Atom,
  Box,
  Camera,
  ChevronRight,
  CircleDot,
  Gauge,
  Hand,
  Orbit,
  Pause,
  RadioTower,
  Sparkles,
} from "lucide-react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import EffectStage from "./EffectStage.jsx";

const CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

const PINCH_THRESHOLD = 0.06;
const RELEASE_THRESHOLD = 0.105;
const RELEASE_CONFIRM_FRAMES = 6;
const LOST_HAND_GRACE_FRAMES = 10;
const DRAG_ROTATION_SCALE = 8.5;
const MAX_ROTATION_STEP = 0.2;
const GESTURE_LABELS = {
  WAITING: "等待手势",
  PINCH: "抓取",
  RELEASE: "释放",
};

const EFFECT_STYLES = [
  {
    id: "orb",
    label: "粒子球",
    detail: "抓取聚拢",
    icon: CircleDot,
  },
  {
    id: "vortex",
    label: "旋涡环",
    detail: "拖动旋转",
    icon: Orbit,
  },
  {
    id: "geometry",
    label: "几何场",
    detail: "线框展开",
    icon: Box,
  },
];

const VISION_WASM_URL = "/wasm";
const HAND_MODEL_URL = "/models/hand_landmarker.task";

function getDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function getPinchPoint(landmarks) {
  const thumb = landmarks[4];
  const index = landmarks[8];
  return {
    x: 1 - (thumb.x + index.x) / 2,
    y: (thumb.y + index.y) / 2,
  };
}

function clamp01(value) {
  return Math.max(0.04, Math.min(0.96, value));
}

function getDragRotationDelta(previousPoint, nextPoint) {
  if (!previousPoint || !nextPoint) return 0;
  const dx = nextPoint.x - previousPoint.x;
  const dy = nextPoint.y - previousPoint.y;
  return dx * DRAG_ROTATION_SCALE + dy * (DRAG_ROTATION_SCALE * 0.32);
}

function getCameraErrorMessage(error) {
  if (!error) return "摄像头启动失败";
  if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
    return "摄像头权限被拒绝";
  }
  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return "未找到摄像头";
  }
  if (error.name === "NotReadableError" || error.name === "TrackStartError") {
    return "摄像头被占用";
  }
  if (error.name === "OverconstrainedError" || error.name === "ConstraintNotSatisfiedError") {
    return "摄像头参数不支持";
  }
  if (error.name === "SecurityError") {
    return "浏览器阻止摄像头";
  }
  return `摄像头启动失败：${error.name || "未知错误"}`;
}

async function createHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(VISION_WASM_URL);
  const options = {
    baseOptions: {
      modelAssetPath: HAND_MODEL_URL,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.52,
    minTrackingConfidence: 0.5,
  };

  try {
    return await HandLandmarker.createFromOptions(vision, options);
  } catch (gpuError) {
    console.warn("GPU 手势模型初始化失败，尝试 CPU。", gpuError);
    return HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: {
        ...options.baseOptions,
        delegate: "CPU",
      },
    });
  }
}

function drawHand(ctx, landmarks, width, height, gesture) {
  ctx.clearRect(0, 0, width, height);
  if (!landmarks) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = gesture === "PINCH" ? "rgba(255, 158, 56, 0.75)" : "rgba(66, 255, 175, 0.62)";
  ctx.shadowBlur = 16;

  CONNECTIONS.forEach(([start, end]) => {
    const a = landmarks[start];
    const b = landmarks[end];
    ctx.beginPath();
    ctx.moveTo((1 - a.x) * width, a.y * height);
    ctx.lineTo((1 - b.x) * width, b.y * height);
    ctx.strokeStyle = gesture === "PINCH" ? "rgba(255, 185, 87, 0.96)" : "rgba(55, 238, 166, 0.92)";
    ctx.lineWidth = start === 0 ? 4 : 3;
    ctx.stroke();
  });

  landmarks.forEach((point, index) => {
    const x = (1 - point.x) * width;
    const y = point.y * height;
    ctx.beginPath();
    ctx.arc(x, y, index === 4 || index === 8 ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = index === 4 || index === 8 ? "#ffb957" : "#42ffaf";
    ctx.fill();
  });

  const pinchPoint = getPinchPoint(landmarks);
  ctx.beginPath();
  ctx.arc(pinchPoint.x * width, pinchPoint.y * height, gesture === "PINCH" ? 28 : 18, 0, Math.PI * 2);
  ctx.strokeStyle = gesture === "PINCH" ? "rgba(255, 158, 56, 0.96)" : "rgba(53, 217, 255, 0.72)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function MappingRow({ active, icon: Icon, label, detail, accent }) {
  return (
    <div className={`mapping-row ${active ? "is-active" : ""}`} style={{ "--accent": accent }}>
      <div className="mapping-icon">
        <Icon size={18} strokeWidth={2.3} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{detail}</strong>
      </div>
      <ChevronRight size={18} />
    </div>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className="metric" style={{ "--tone": tone }}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StyleButton({ active, icon: Icon, label, detail, onClick }) {
  return (
    <button className={`style-button ${active ? "is-selected" : ""}`} onClick={onClick} type="button">
      <Icon size={17} />
      <span>
        <strong>{label}</strong>
        <em>{detail}</em>
      </span>
    </button>
  );
}

export default function App() {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const landmarkerRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const previousGestureRef = useRef("RELEASE");
  const lastVideoTimeRef = useRef(-1);
  const releaseIdRef = useRef(1);
  const releaseFrameRef = useRef(0);
  const lostHandFrameRef = useRef(0);
  const lastPinchPointRef = useRef(null);
  const dragRotationRef = useRef(0);

  const [cameraState, setCameraState] = useState("idle");
  const [cameraMessage, setCameraMessage] = useState("就绪");
  const [gesture, setGesture] = useState("WAITING");
  const [confidence, setConfidence] = useState(0);
  const [pinchDistance, setPinchDistance] = useState(0);
  const [releaseEvent, setReleaseEvent] = useState(null);
  const [gesturePoint, setGesturePoint] = useState(null);
  const [gestureRotation, setGestureRotation] = useState(0);
  const [effectStyle, setEffectStyle] = useState("orb");
  const [energy, setEnergy] = useState(90);
  const [density, setDensity] = useState(84);
  const [rotationSensitivity, setRotationSensitivity] = useState(100);
  const [showGrid, setShowGrid] = useState(true);

  const statusLabel = useMemo(() => {
    if (cameraState === "tracking") return "追踪中";
    if (cameraState === "loading") return "预热中";
    if (cameraState === "model-error") return "模型不可用";
    if (cameraState === "error") return "摄像头不可用";
    return "待机";
  }, [cameraState]);

  const displayGesture = GESTURE_LABELS[gesture];
  const currentEffectStyle = EFFECT_STYLES.find((style) => style.id === effectStyle) ?? EFFECT_STYLES[0];

  const cameraHint = useMemo(() => {
    if (cameraState === "error") {
      return `${cameraMessage}。请检查浏览器地址栏摄像头权限、系统隐私设置，或确认摄像头没有被其他应用占用。`;
    }
    if (cameraState === "model-error") {
      return "摄像头已尝试启动，但手势模型加载失败。请检查网络是否能访问 MediaPipe 模型文件。";
    }
    if (cameraState === "loading") {
      return cameraMessage;
    }
    if (cameraState === "tracking") {
      return "请把手放入画面，拇指和食指捏合后可左右拖动旋转，完全松开后触发聚合绽放。";
    }
    return "点击启动摄像头后，请在浏览器权限弹窗中允许摄像头访问。";
  }, [cameraMessage, cameraState]);

  const triggerRelease = useCallback((point) => {
    const nextPoint = {
      x: clamp01(point.x),
      y: clamp01(point.y),
    };
    setReleaseEvent({
      id: releaseIdRef.current,
      x: nextPoint.x,
      y: nextPoint.y,
      style: effectStyle,
      at: Date.now(),
    });
    releaseIdRef.current += 1;
  }, [effectStyle]);

  const stopCamera = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraState("idle");
    setCameraMessage("就绪");
    setGesture("WAITING");
    setGesturePoint(null);
    setGestureRotation(0);
    setConfidence(0);
    setPinchDistance(0);
    previousGestureRef.current = "RELEASE";
    releaseFrameRef.current = 0;
    lostHandFrameRef.current = 0;
    lastPinchPointRef.current = null;
    dragRotationRef.current = 0;
  }, []);

  const runDetection = useCallback(() => {
    const video = videoRef.current;
    const canvas = overlayRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !canvas || !landmarker) return;

    const ctx = canvas.getContext("2d");
    const width = video.clientWidth || 640;
    const height = video.clientHeight || 480;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    if (video.readyState >= 2 && video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      const results = landmarker.detectForVideo(video, performance.now());
      const landmarks = results.landmarks?.[0];

      if (landmarks) {
        lostHandFrameRef.current = 0;
        const distance = getDistance(landmarks[4], landmarks[8]);
        const previousGesture = previousGestureRef.current;
        const pinchPoint = getPinchPoint(landmarks);
        const confirmingRelease = previousGesture === "PINCH" && distance > RELEASE_THRESHOLD;
        let nextGesture = previousGesture === "PINCH" ? "PINCH" : "RELEASE";
        let releasePoint = null;

        if (previousGesture === "PINCH") {
          if (confirmingRelease) {
            releaseFrameRef.current += 1;
            if (releaseFrameRef.current >= RELEASE_CONFIRM_FRAMES) {
              nextGesture = "RELEASE";
              releasePoint = lastPinchPointRef.current ?? pinchPoint;
            }
          } else {
            releaseFrameRef.current = 0;
            nextGesture = "PINCH";
          }
        } else if (distance < PINCH_THRESHOLD) {
          nextGesture = "PINCH";
          releaseFrameRef.current = 0;
          lastPinchPointRef.current = pinchPoint;
          dragRotationRef.current = 0;
        }

        if (nextGesture === "PINCH") {
          const stablePoint = confirmingRelease ? (lastPinchPointRef.current ?? pinchPoint) : pinchPoint;
          const rotationDelta = confirmingRelease ? 0 : getDragRotationDelta(lastPinchPointRef.current, stablePoint);
          if (Math.abs(rotationDelta) <= MAX_ROTATION_STEP) {
            dragRotationRef.current += rotationDelta;
          }
          if (!confirmingRelease) {
            lastPinchPointRef.current = stablePoint;
          }
          setGesturePoint(stablePoint);
          setGestureRotation(dragRotationRef.current);
        } else {
          setGesturePoint(null);
          setGestureRotation(0);
        }

        setPinchDistance(distance);
        setConfidence(Math.round(Math.max(0, Math.min(1, 1 - distance / 0.16)) * 100));
        setGesture(nextGesture);
        setCameraState("tracking");
        setCameraMessage(confirmingRelease && nextGesture === "PINCH" ? "抓取保持" : "手部锁定");
        drawHand(ctx, landmarks, width, height, nextGesture);

        if (previousGesture === "PINCH" && nextGesture === "RELEASE") {
          triggerRelease(releasePoint ?? pinchPoint);
          lastPinchPointRef.current = null;
          dragRotationRef.current = 0;
          releaseFrameRef.current = 0;
        }
        previousGestureRef.current = nextGesture;
      } else {
        ctx.clearRect(0, 0, width, height);
        if (previousGestureRef.current === "PINCH" && lastPinchPointRef.current && lostHandFrameRef.current < LOST_HAND_GRACE_FRAMES) {
          lostHandFrameRef.current += 1;
          setGesture("PINCH");
          setGesturePoint(lastPinchPointRef.current);
          setGestureRotation(dragRotationRef.current);
          setCameraMessage("抓取保持");
          rafRef.current = requestAnimationFrame(runDetection);
          return;
        }
        setGesture("WAITING");
        setGesturePoint(null);
        setGestureRotation(0);
        setConfidence(0);
        setCameraMessage("扫描中");
        previousGestureRef.current = "RELEASE";
        releaseFrameRef.current = 0;
        lostHandFrameRef.current = 0;
        lastPinchPointRef.current = null;
        dragRotationRef.current = 0;
      }
    }

    rafRef.current = requestAnimationFrame(runDetection);
  }, [triggerRelease]);

  const startCamera = useCallback(async () => {
    if (cameraState === "loading" || cameraState === "tracking") return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("error");
      setCameraMessage("浏览器不支持摄像头");
      return;
    }

    try {
      setCameraState("loading");
      setCameraMessage("请求摄像头");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();

      setCameraMessage("加载手势模型");
      if (!landmarkerRef.current) {
        landmarkerRef.current = await createHandLandmarker();
      }

      previousGestureRef.current = "RELEASE";
      releaseFrameRef.current = 0;
      lostHandFrameRef.current = 0;
      lastPinchPointRef.current = null;
      dragRotationRef.current = 0;
      setCameraState("tracking");
      setCameraMessage("扫描中");
      runDetection();
    } catch (error) {
      console.error(error);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      if (error.message?.includes("hand_landmarker") || error.message?.includes("MediaPipe") || error.message?.includes("WASM")) {
        setCameraState("model-error");
        setCameraMessage("手势模型加载失败");
        return;
      }
      setCameraState("error");
      setCameraMessage(getCameraErrorMessage(error));
    }
  }, [cameraState, runDetection]);

  useEffect(() => stopCamera, [stopCamera]);

  return (
    <main className="app-shell">
      <section className="command-panel camera-panel">
        <header className="brand-row">
          <div>
            <span className="eyebrow">GESTURIFY</span>
            <h1>手势特效控制台</h1>
          </div>
          <span className={`status-pill ${cameraState === "tracking" ? "is-live" : ""}`}>
            <RadioTower size={15} />
            {statusLabel}
          </span>
        </header>

        <div className="camera-feed">
          <video ref={videoRef} playsInline muted />
          <canvas ref={overlayRef} />
          <div className={`scan-grid ${showGrid ? "is-visible" : ""}`} />
          <div className="feed-corners" />
          <div className="feed-label">
            <Activity size={15} />
            {cameraMessage}
          </div>
        </div>

        <div className="camera-actions">
          <button className="primary-button" onClick={startCamera} disabled={cameraState === "loading" || cameraState === "tracking"}>
            <Camera size={18} />
            {cameraState === "tracking" ? "摄像头已开启" : "启动摄像头"}
          </button>
          <button className="icon-button" onClick={stopCamera} title="停止摄像头" aria-label="停止摄像头">
            <Pause size={18} />
          </button>
          <button className={`icon-button ${showGrid ? "is-active" : ""}`} onClick={() => setShowGrid((value) => !value)} title="切换扫描网格" aria-label="切换扫描网格">
            <Aperture size={18} />
          </button>
        </div>

        <div className={`camera-hint ${cameraState === "error" || cameraState === "model-error" ? "is-error" : ""}`}>
          {cameraHint}
        </div>

        <div className="metrics-grid">
          <Metric label="锁定度" value={`${confidence}%`} tone="#42ffaf" />
          <Metric label="捏合距离" value={pinchDistance ? pinchDistance.toFixed(3) : "0.000"} tone="#ffb957" />
          <Metric label="当前动作" value={displayGesture} tone={gesture === "PINCH" ? "#ff9e38" : "#35d9ff"} />
        </div>
      </section>

      <section className="command-panel mapping-panel">
        <div className="panel-heading">
          <span>手势映射</span>
          <strong>{displayGesture}</strong>
        </div>
        <div className="mapping-stack">
          <MappingRow active={gesture === "PINCH"} icon={Hand} label="捏合 / 抓取" detail="锁定目标" accent="#ff9e38" />
          <MappingRow active={gesture === "RELEASE"} icon={Sparkles} label="释放" detail="聚合绽放" accent="#35d9ff" />
          <MappingRow active={gesture === "PINCH"} icon={Atom} label="抓住拖动" detail={currentEffectStyle.label} accent="#58ffb0" />
        </div>

        <div className="control-cluster">
          <label>
            <span>
              <Gauge size={15} />
              能量
            </span>
            <input type="range" min="45" max="125" value={energy} onChange={(event) => setEnergy(Number(event.target.value))} />
          </label>
          <label>
            <span>
              <Sparkles size={15} />
              粒子密度
            </span>
            <input type="range" min="36" max="140" value={density} onChange={(event) => setDensity(Number(event.target.value))} />
          </label>
          <label>
            <span>
              <Orbit size={15} />
              旋转灵敏度
              <strong className="control-value">{rotationSensitivity}%</strong>
            </span>
            <input
              type="range"
              min="0"
              max="220"
              value={rotationSensitivity}
              onChange={(event) => setRotationSensitivity(Number(event.target.value))}
            />
          </label>
          <div className="style-control" aria-label="特效样式">
            <span>
              <Atom size={15} />
              特效样式
            </span>
            <div className="style-grid">
              {EFFECT_STYLES.map((style) => (
                <StyleButton
                  key={style.id}
                  active={effectStyle === style.id}
                  icon={style.icon}
                  label={style.label}
                  detail={style.detail}
                  onClick={() => setEffectStyle(style.id)}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <EffectStage
        releaseEvent={releaseEvent}
        gesture={gesture}
        gesturePoint={gesturePoint}
        gestureRotation={gestureRotation}
        effectStyle={effectStyle}
        energy={energy}
        density={density}
        rotationSensitivity={rotationSensitivity}
      />
    </main>
  );
}
