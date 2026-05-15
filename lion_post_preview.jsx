export default function LionPostPreview() {
  return (
    <div style={{ background: '#111', padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <h2 style={{ color: '#fff', marginBottom: '8px', fontSize: '18px' }}>LinkedIn Post Image Preview</h2>
      <p style={{ color: '#999', fontSize: '13px', marginBottom: '20px' }}>This is your final composite image</p>

      <div style={{
        position: 'relative',
        width: '100%',
        maxWidth: '900px',
        aspectRatio: '1200/628',
        overflow: 'hidden',
        borderRadius: '8px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
      }}>
        <img
          src="https://images.unsplash.com/photo-1546182990-dffeafbe841d?w=1400&q=80"
          alt="Lion close-up"
          style={{
            position: 'absolute',
            top: '-15%',
            left: 0,
            width: '100%',
            minHeight: '130%',
            objectFit: 'cover',
            objectPosition: 'center 25%'
          }}
        />
        <div style={{
          position: 'absolute',
          top: 0, left: 0,
          width: '100%', height: '100%',
          background: 'linear-gradient(to right, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.75) 40%, rgba(0,0,0,0.25) 65%, transparent 85%)'
        }} />
        <div style={{
          position: 'absolute',
          top: 0, left: 0,
          width: '58%', height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '8% 5%',
          zIndex: 2
        }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(20px, 3.5vw, 40px)', fontWeight: 'bold', color: '#fff', lineHeight: 1.3, textShadow: '0 2px 10px rgba(0,0,0,0.7)' }}>
            If your demo can't
          </div>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(20px, 3.5vw, 40px)', fontWeight: 'bold', color: '#fff', lineHeight: 1.3, textShadow: '0 2px 10px rgba(0,0,0,0.7)' }}>
            survive <span style={{ color: '#f5a623' }}>chaos</span>,
          </div>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(20px, 3.5vw, 40px)', fontWeight: 'bold', color: '#fff', lineHeight: 1.3, textShadow: '0 2px 10px rgba(0,0,0,0.7)' }}>
            it's not a demo.
          </div>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(22px, 3.8vw, 42px)', fontWeight: 'bold', color: '#f5a623', lineHeight: 1.3, textShadow: '0 2px 10px rgba(0,0,0,0.7)', marginTop: '20px' }}>
            It's a performance.
          </div>
          <div style={{ width: '80px', height: '4px', background: '#f5a623', marginTop: '24px', marginBottom: '16px', borderRadius: '2px' }} />
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(12px, 1.8vw, 20px)', color: '#ccc', fontStyle: 'italic', textShadow: '0 1px 6px rgba(0,0,0,0.6)' }}>
            The Wild Animal Test for AI
          </div>
        </div>
        <div style={{ position: 'absolute', bottom: '12px', left: '5%', fontSize: '11px', color: 'rgba(255,255,255,0.35)', zIndex: 2 }}>
          Photo: Rob Potter / Unsplash
        </div>
      </div>

      <p style={{ color: '#888', fontSize: '13px', marginTop: '16px', textAlign: 'center' }}>
        To save: right-click the image → "Save image as" or screenshot it with Win+Shift+S
      </p>
    </div>
  );
}
