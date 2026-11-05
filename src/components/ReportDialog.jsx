import { useState } from 'react';
import { shrinkPhoto } from '../lib/reports.js';

export default function ReportDialog({ onSave, onCancel }) {
  const [photo, setPhoto] = useState(null);
  const [error, setError] = useState('');

  async function choosePhoto(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
      setPhoto(await shrinkPhoto(file));
      setError('');
    } catch (problem) {
      setError(problem.message);
    }
  }

  return (
    <div className="dialog-backdrop fade-in">
      <div className="token dialog pop-in" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <p className="meta dim">Flood report</p>
        <h2 id="report-title" className="token-title">
          Report flooding here
        </h2>
        <p>Routes will avoid roads within about 120 m of this point.</p>
        <div className="token-perf" />
        <label className="photo-field">
          <span className="meta">Add a photo (optional)</span>
          <input type="file" accept="image/*" capture="environment" onChange={choosePhoto} />
        </label>
        {photo && <img className="photo-preview" src={photo} alt="Your flood report" />}
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-tangerine" onClick={() => onSave(photo)}>
            Add report
          </button>
        </div>
      </div>
    </div>
  );
}
