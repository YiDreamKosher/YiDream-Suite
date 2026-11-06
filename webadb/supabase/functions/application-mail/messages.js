export const ADMIN_URL='https://yidreamkosher.github.io/YiDream-Suite/admin/';
export function applicationMessage(event){
 const messages={
  pending:{subject:'YiDream — candidature reçue',text:'Bonjour,\n\nVotre candidature administrateur YiDream a bien été enregistrée. Elle est en attente d’examen par le propriétaire. Aucun accès administrateur n’est ouvert avant approbation.\n\nVous pouvez retrouver son statut en vous connectant à votre espace.'},
  approved:{subject:'YiDream — votre accès administrateur est approuvé',text:'Bonjour,\n\nVotre candidature YiDream a été approuvée. Votre accès administrateur est maintenant ouvert. Connectez-vous avec le même compte pour retrouver votre espace et préparer vos appareils.'},
  rejected:{subject:'YiDream — décision concernant votre candidature',text:'Bonjour,\n\nVotre candidature administrateur YiDream a été examinée et n’a pas été approuvée. Votre compte reste accessible pour consulter cette décision. Pour toute question, vous pouvez répondre à ce message.'}
 };
 if(!messages[event])throw Error('Unsupported application event');
 return {...messages[event],text:messages[event].text+'\n\n'+ADMIN_URL+'\n\nL’équipe YiDream\nyiddishdream@gmail.com'};
}
