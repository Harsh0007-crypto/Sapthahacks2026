/**
 * Splits text into words → characters so GSAP can animate each letter.
 * Animated by LandingPage via the .lp-kinetic / data-kin attributes.
 */
export default function KineticText({ text, as: Tag = 'span', kin = 'scroll', className = '' }) {
  const words = text.split(' ');
  return (
    <Tag className={`lp-kinetic ${className}`} data-kin={kin} aria-label={text}>
      {words.map((word, wi) => (
        <span className="lp-kword" key={`${word}-${wi}`} aria-hidden="true">
          {word.split('').map((ch, ci) => (
            <span className="lp-kchar" key={ci}>
              {ch}
            </span>
          ))}
          {wi < words.length - 1 ? '\u00A0' : ''}
        </span>
      ))}
    </Tag>
  );
}
