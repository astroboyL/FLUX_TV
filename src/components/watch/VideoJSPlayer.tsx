import { useEffect, useRef } from "react";
import Player from "video.js/dist/types/player";
import videojs from "video.js";
import "video.js/dist/video-js.css";

export default function VideoJSPlayer({
  options,
  onReady,
}: {
  options: any;
  onReady: (player: Player) => void;
}) {
  const videoRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<Player | null>(null);

  useEffect(() => {
    (async function handleVideojs() {
      // Make sure Video.js player is only initialized once
      if (!playerRef.current) {
        // The Video.js player needs to be _inside_ the component el for React 18 Strict Mode.
        const videoElement = document.createElement("video-js");
        videoElement.classList.add("video-js", "vjs-big-play-centered", "vjs-fill");
        videoElement.setAttribute("playsinline", "true");
        videoElement.setAttribute("crossorigin", "anonymous");
        videoElement.style.width = "100%";
        videoElement.style.height = "100%";

        videoRef.current?.appendChild(videoElement);
        const player = (playerRef.current = videojs(
          videoElement,
          options,
          () => {
            onReady && onReady(player);
          }
        ));
      } else {
        const player = playerRef.current;
        player.autoplay(options.autoplay);
        player.controls(options.controls);
        player.muted(Boolean(options.muted));
        if (typeof options.volume === "number") {
          player.volume(options.volume);
        }
        if (options.playbackRates?.length) {
          player.playbackRates(options.playbackRates);
        }
        if (options.width) {
          player.width(options.width);
        }
        if (options.height) {
          player.height(options.height);
        }
        if (options.sources?.length) {
          player.pause();
          player.src(options.sources);
          player.load();
          if (options.autoplay) {
            player.play()?.catch(() => undefined);
          }
        }
      }
    })();
  }, [options, videoRef]);

  // Dispose the Video.js player when the functional component unmounts
  useEffect(() => {
    const player = playerRef.current;

    return () => {
      if (player && !player.isDisposed()) {
        player.dispose();
        playerRef.current = null;
      }
    };
  }, [playerRef]);

  return (
    <div data-vjs-player style={{ width: "100%", height: "100%" }}>
      <div ref={videoRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
