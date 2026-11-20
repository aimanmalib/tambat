import { config } from '../../src/config';
import { useText } from '../i18n';
import './video.css';

/**
 * The demo video, served from this site (config.video). It has no sound: the captions are part of the picture, so the
 * page says so and gives the file for download as well.
 */
export function VideoPage() {
  const { t } = useText();
  const v = config.video;
  return (
    <section className="card" aria-labelledby="video-title">
      <h1 className="card__title" id="video-title">{t('video.title')}</h1>
      <p className="option__help">{t('video.sub', { seconds: v.seconds })}</p>
      <div className="video">
        <video className="video__player" controls playsInline preload="metadata" poster={v.posterUrl} aria-describedby="video-note" data-video>
          <source src={v.url} type="video/mp4" />
        </video>
      </div>
      <p className="option__help" id="video-note">{t('video.note')}</p>
      <p>
        <a href={v.url} download data-video-file>{t('video.download')}</a>
      </p>
    </section>
  );
}
