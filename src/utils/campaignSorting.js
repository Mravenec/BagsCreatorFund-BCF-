export const sortCampaignsByPriority = (campaigns) => {
  const priorityOrder = {
    'active': 1,
    'pending': 2,
    'settled': 3,
    'finished': 3
  };
  
  return [...campaigns].sort((a, b) => {
    // 1. Primary order: by status
    const priorityA = priorityOrder[a.status] || 999;
    const priorityB = priorityOrder[b.status] || 999;
    
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    
    // 2. Secondary order: by start_ts (newest first)
    if (a.start_ts && b.start_ts) {
      return b.start_ts - a.start_ts;
    }
    
    // 3. Tertiary order: by created_at (newest first)
    if (a.created_at && b.created_at) {
      return b.created_at - a.created_at;
    }
    
    // 4. Fallback: alphabetical by title (a.name in user prompt, but our fields are a.title typically, I'll use title or name)
    const titleA = a.title || a.name || "";
    const titleB = b.title || b.name || "";
    return titleA.localeCompare(titleB);
  });
};
