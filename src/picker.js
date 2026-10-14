export function pickerItems(task,query=''){const needle=query.trim().toLowerCase();return task.items.filter(item=>[item.id,item.label,item.description].join(' ').toLowerCase().includes(needle));}
export function movePicker(task,delta,query=''){const count=pickerItems(task,query).length;task.index=count?(task.index+delta+count)%count:0;}
export function selectedItem(task,query=''){const items=pickerItems(task,query);task.index=Math.max(0,Math.min(task.index,items.length-1));return items[task.index]||null;}
